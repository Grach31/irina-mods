"""Check product-gallery photos and prepare content-addressed JPEGs for Moda."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import http.client
from html.parser import HTMLParser
from ipaddress import ip_address
import io
import json
from pathlib import Path
import re
import socket
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urldefrag, urljoin, urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

from PIL import Image, ImageOps

from media_contract import MODA_PHOTOS, MODA_PHOTO_URL, sha

BRANDS = set("""sela.ru limestore.com loverepublic.ru befree.ru studio-29.ru
allweneed.ru idol.ru tvoe.ru toptop.ru emkashop.ru charuel.ru brusnikabrand.com
elis.ru gate31.ru cocos-moscow.ru 1811stores.com ushatava.ru laroom.ru
sodamoda.ru belleyou.ru monochrome.ru grigri.ru ru.krakatauwear.com
shuclothes.com novayawear.com rxbshoes.com askent.ru arnypraht.com
jewelry-in-august.com saharokstore.ru qariqris.com alenaakhmadullina.ru
tegin.com vassatrend.ru rubancouture.com 2moodstore.com""".split())
MAX_PHOTO = 12_000_000
MAX_PAGE = 4_000_000
MAX_PIXELS = 35_000_000
MIN_BYTES = 3000
MIN_SIDE = 300
ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,95}")
FORMATS = {"JPEG": {"image/jpeg", "image/jpg", "image/pjpeg"}, "PNG": {"image/png"},
           "WEBP": {"image/webp"}}
RETRYABLE_HTTP = {408, 425, 429, 500, 502, 503, 504}


class CheckError(ValueError):
    def __init__(self, code, message, *, status=None, attempts=1):
        super().__init__(message)
        self.code, self.status, self.attempts = code, status, attempts


def public_host(url):
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
        if (parts.scheme != "https" or not re.fullmatch(r"[a-z0-9.-]+\.[a-z][a-z0-9-]*", host)
                or parts.port not in (None, 443) or parts.username is not None
                or parts.password is not None or any(c.isspace() for c in url) or "\\" in url):
            raise ValueError
        return host.removeprefix("www.")
    except ValueError as exc:
        raise CheckError("invalid_url", "Expected a public HTTPS URL on port 443") from exc


def connect_public(address, timeout, source_address=None):
    host, port = address
    records = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    last_error = None
    for family, socktype, proto, _, endpoint in records:
        if not ip_address(endpoint[0]).is_global:
            continue
        with socket.socket(family, socktype, proto) as sock:
            try:
                sock.settimeout(timeout)
                if source_address:
                    sock.bind(source_address)
                sock.connect(endpoint)
                return sock.dup()
            except OSError as exc:
                last_error = exc
    if last_error:
        raise last_error
    raise CheckError("invalid_url", "Host has no public destination")


class PublicHTTPS(HTTPSHandler):
    def https_open(self, req):
        def connection(host, **kwargs):
            conn = http.client.HTTPSConnection(host, **kwargs)
            conn._create_connection = connect_public
            return conn
        return self.do_open(connection, req, context=self._context)


class CheckedRedirect(HTTPRedirectHandler):
    max_redirections = 4

    def __init__(self, check):
        self.check = check

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.check(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Downloader:
    def __init__(self, *, use_proxy=False, timeout=8, pause=time.sleep):
        self.use_proxy = use_proxy
        self.timeout = timeout
        self.pause = pause

    def host(self, url):
        return public_host(url)

    def opener(self, check):
        redirect = CheckedRedirect(check)
        if self.use_proxy:
            return build_opener(redirect)
        return build_opener(ProxyHandler({}), PublicHTTPS(), redirect)

    def get(self, url, *, page=False, referer=None):
        origin = self.host(url)
        product_path = urlsplit(url).path.rstrip("/")

        def check(candidate):
            host = self.host(candidate)
            if page and (host != origin or urlsplit(candidate).path.rstrip("/") != product_path):
                raise CheckError("unexpected_redirect", "Product URL redirected to a different page")

        opener = self.opener(check)
        limit = MAX_PAGE if page else MAX_PHOTO
        headers = {"User-Agent": "Mozilla/5.0 (compatible; StamboEditorial/1.0)",
                   "Accept": "text/html,application/xhtml+xml" if page else "image/*"}
        if referer:
            headers["Referer"] = referer
        for attempt in range(1, 4):
            retry_delay = 2 ** (attempt - 1)
            try:
                with opener.open(Request(url, headers=headers), timeout=self.timeout) as response:
                    if response.status != 200:
                        raise CheckError(f"http_{response.status}", "Expected HTTP 200", status=response.status)
                    mime = response.headers.get_content_type()
                    if not (mime in {"text/html", "application/xhtml+xml"} if page
                            else mime.startswith("image/")):
                        raise CheckError("content_type", f"Unexpected Content-Type: {mime}", status=200)
                    length = response.headers.get("Content-Length", "")
                    if length.isdecimal() and int(length) > limit:
                        raise CheckError("size", "Response exceeds byte limit", status=200)
                    # Read incrementally and cap total body time, even if packets keep arriving.
                    deadline = time.monotonic() + 2 * self.timeout
                    raw = bytearray()
                    while chunk := response.read1(min(65536, limit + 1 - len(raw))):
                        raw.extend(chunk)
                        if len(raw) > limit:
                            raise CheckError("size", "Response exceeds byte limit", status=200)
                        if time.monotonic() > deadline:
                            raise TimeoutError
                    if length.isdecimal() and len(raw) != int(length):
                        raise http.client.IncompleteRead(bytes(raw), int(length) - len(raw))
                    return bytes(raw), mime, response.geturl(), attempt
            except HTTPError as exc:
                status = exc.code
                after = exc.headers.get("Retry-After", "") if exc.headers else ""
                exc.close()
                if after.isdecimal() and len(after) < 6:
                    retry_delay = min(10, max(retry_delay, int(after)))
                if status not in RETRYABLE_HTTP or attempt == 3:
                    raise CheckError(f"http_{status}", f"HTTP {status}", status=status, attempts=attempt) from exc
            except (OSError, http.client.HTTPException) as exc:
                reason = exc.reason if isinstance(exc, URLError) else exc
                code = "timeout" if isinstance(reason, TimeoutError) else "network"
                if attempt == 3:
                    raise CheckError(code, f"Download failed ({code})", attempts=attempt) from exc
            except CheckError as exc:
                exc.attempts = attempt
                raise
            self.pause(retry_delay)


def product_images(data, matches):
    if not isinstance(data, dict):
        return
    types = data.get("@type")
    if types == "Product" or isinstance(types, list) and "Product" in types:
        if data.get("url") and not matches(data["url"]):
            return
        images = data.get("image") or []
        for image in images if isinstance(images, list) else [images]:
            yield (image.get("contentUrl") or image.get("url")) if isinstance(image, dict) else image
    for key in ("@graph", "mainEntity"):
        children = data.get(key, [])
        for child in children if isinstance(children, list) else [children]:
            yield from product_images(child, matches)


class ProductGallery(HTMLParser):
    """Read product metadata and marked product galleries, excluding ordinary images."""

    VOID = set("area base br col embed hr img input link meta param source track wbr".split())
    GALLERY_CLASS = re.compile(r"(?:^|\s)(?:product[-_]gallery(?:\s|__|$)|product-page--slider(?:\s|$)|ProductGallery[A-Z])", re.I)
    RECOMMENDATIONS = re.compile(r"recommend|related|similar|cross[-_]?sell|upsell", re.I)

    def __init__(self, url):
        super().__init__()
        self.url = url
        self.stack = []
        self.structured = []
        self.gallery = []
        self.preview = []
        self.ld = None
        self.page_kind = None
        self.canonical = None

    def matches(self, candidate):
        if not isinstance(candidate, str):
            return False
        try:
            current, other = urlsplit(self.url), urlsplit(urljoin(self.url, candidate))
        except ValueError:
            return False
        return ((current.hostname or "").removeprefix("www.") == (other.hostname or "").removeprefix("www.")
                and current.path.rstrip("/") == other.path.rstrip("/"))

    def handle_starttag(self, tag, attrs):
        info = dict(attrs)
        classes = info.get("class") or ""
        inside, excluded = self.stack[-1][1:] if self.stack else (False, False)
        excluded = excluded or bool(self.RECOMMENDATIONS.search(classes))
        inside = inside or bool(self.GALLERY_CLASS.search(classes)) or info.get("data-fancybox") == "mainProduct"
        if tag not in self.VOID:
            self.stack.append((tag, inside, excluded))
        if tag == "script" and info.get("type") == "application/ld+json":
            self.ld = []
        if tag == "link" and info.get("rel") == "canonical":
            self.canonical = info.get("href")
        if tag == "meta":
            key = info.get("property")
            if key in ("og:image", "og:image:secure_url"):
                self.preview.append(info.get("content"))
            if key == "og:type":
                self.page_kind = info.get("content")
        if excluded:
            return
        if tag == "section" and "ProductPage" in classes.split() and info.get("data-product"):
            try:
                product = json.loads(info["data-product"])
                if self.matches(product.get("url")):
                    self.gallery.extend(row.get("original_url") for row in product.get("images", []))
            except (ValueError, TypeError, AttributeError):
                pass
        if inside and tag in {"a", "img", "source"}:
            keys = ("href", "data-url") if tag == "a" else ("data-src", "src")
            self.gallery.extend(info.get(key) for key in keys)
            for key in ("srcset", "data-srcset"):
                for source in (info.get(key) or "").split(","):
                    if source.strip():
                        self.gallery.append(source.split()[0])

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data):
        if self.ld is not None:
            self.ld.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.ld is not None:
            try:
                payload = json.loads("".join(self.ld))
                for entry in payload if isinstance(payload, list) else [payload]:
                    self.structured.extend(product_images(entry, self.matches))
            except (ValueError, TypeError, RecursionError):
                pass
            self.ld = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def urls(self, check_url):
        if self.canonical and not self.matches(self.canonical):
            raise CheckError("not_product_page", "Canonical URL points to a different page")
        preview = self.preview if self.gallery or self.structured or self.page_kind == "product" else []
        verified = {}
        for raw in self.structured + preview + self.gallery:
            if not isinstance(raw, str) or not raw.strip():
                continue
            try:
                url = urldefrag(urljoin(self.url, raw.strip())).url
                check_url(url)
            except ValueError:
                continue
            if urlsplit(url).path.lower().endswith((".svg", ".mp4", ".avif", ".gif", ".html")):
                continue
            verified[url] = None
        return list(verified)


def normalized_jpeg(raw, mime):
    if not MIN_BYTES <= len(raw) <= MAX_PHOTO:
        raise CheckError("size", f"Image must be {MIN_BYTES}–{MAX_PHOTO} bytes", status=200)
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in FORMATS or mime not in FORMATS[source.format]:
                raise CheckError("format", "Declared Content-Type and supported image format must match", status=200)
            if min(source.size) < MIN_SIDE or source.width * source.height > MAX_PIXELS:
                raise CheckError("resolution", "Image is outside permitted dimensions", status=200)
            if getattr(source, "n_frames", 1) != 1:
                raise CheckError("format", "Expected a still image", status=200)
            source.verify()
        with Image.open(io.BytesIO(raw)) as source:
            source.load()
            photo = ImageOps.exif_transpose(source).convert("RGB")
    except (OSError, SyntaxError, Image.DecompressionBombError, ValueError) as exc:
        if isinstance(exc, CheckError):
            raise
        raise CheckError("decode", "Image could not be decoded completely", status=200) from exc
    width, height = photo.size
    photo.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
    if min(photo.size) < MIN_SIDE:
        raise CheckError("resolution", "Image aspect ratio is too extreme", status=200)
    output = io.BytesIO()
    photo.save(output, "JPEG", quality=88, optimize=True)
    return output.getvalue(), width, height


def failure(url, error):
    return {"url": url, "code": error.code, "http_status": error.status,
            "attempts": error.attempts, "message": str(error)}


def verify_item(item, download, brands):
    url = item["product_url"]
    result = {"key": item["key"], "product_url": url, "status": "replace_product", "failures": []}
    errors = result["failures"]
    try:
        if download.host(url) not in brands:
            raise CheckError("brand_not_allowed", "Product URL must belong to an approved brand")
        body, _, page_url, attempts = download.get(url, page=True)
        result["page"] = {"url": page_url, "http_status": 200, "attempts": attempts}
        gallery = ProductGallery(page_url)
        gallery.feed(body.decode("utf-8", errors="replace"))
        gallery.close()
        candidates = gallery.urls(download.host)
    except CheckError as exc:
        errors.append(failure(url, exc))
        return result, None
    preferred = item.get("preferred_images", [])
    for image in preferred:
        if image not in candidates:
            errors.append(failure(image, CheckError("not_in_gallery", "URL is absent from product gallery")))
    ordered = list(dict.fromkeys([image for image in preferred if image in candidates] + candidates))
    if not ordered:
        errors.append(failure(page_url, CheckError("gallery_empty", "No attributable product photos found")))
    for image in ordered[:6]:
        attempts = 1
        try:
            raw, mime, final, attempts = download.get(image, referer=page_url)
            jpg, width, height = normalized_jpeg(raw, mime)
        except CheckError as exc:
            exc.attempts = max(attempts, exc.attempts)
            errors.append(failure(image, exc))
            continue
        digest = sha(jpg)
        result.update(status="verified", photo={
            "source_url": image, "final_url": final, "http_status": 200, "content_type": mime,
            "bytes": len(raw), "width": width, "height": height, "attempts": attempts,
            "sha256": digest, "img": MODA_PHOTO_URL + digest + ".jpg",
        })
        return result, jpg
    return result, None


def validate_request(request):
    if not isinstance(request, dict) or type(request.get("schema_version")) is not int or request["schema_version"] != 1:
        raise ValueError("Expected request schema_version 1")
    cards = request.get("cards")
    if not isinstance(cards, list) or not 1 <= len(cards) <= 2:
        raise ValueError("Expected 1–2 cards")
    card_ids = set()
    for card in cards:
        card_id, items = card.get("id"), card.get("items")
        if not isinstance(card_id, str) or not ID.fullmatch(card_id) or card_id in card_ids:
            raise ValueError("Expected unique card ID")
        card_ids.add(card_id)
        if not isinstance(items, list) or not 1 <= len(items) <= 3:
            raise ValueError("Expected 1–3 items per card")
        keys = set()
        for item in items:
            key, url = item.get("key"), item.get("product_url")
            if not isinstance(key, str) or not ID.fullmatch(key) or key in keys:
                raise ValueError("Expected unique item key within card")
            keys.add(key)
            keys.add(key)
            links = item.get("preferred_images", [])
            if (not isinstance(links, list) or len(links) > 3 or
                    not all(isinstance(link, str) and 0 < len(link) <= 2048 for link in [url, *links])):
                raise ValueError("Expected a product URL and at most three preferred image URLs")


def preflight(raw, request_id, out, download, brands=BRANDS):
    if not ID.fullmatch(request_id):
        raise ValueError("Invalid request ID")
    result = {"schema_version": 1, "request_id": request_id, "request_sha256": sha(raw), "cards": []}
    result_path = out / "moda/results" / (request_id + ".json")
    result_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if len(raw) > 48_000:
            raise ValueError("Request exceeds byte limit")
        request = json.loads(raw)
        validate_request(request)
    except (ValueError, AttributeError, RecursionError) as exc:
        result.update(status="invalid_request", message=str(exc))
    else:
        result["status"] = "completed"
        work = [item for card in request["cards"] for item in card["items"]]
        photos = out / MODA_PHOTOS
        photos.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=6) as pool:
            outcomes = iter(pool.map(partial(verify_item, download=download, brands=brands), work))
            for card in request["cards"]:
                items = []
                for _ in card["items"]:
                    item, jpg = next(outcomes)
                    if jpg is not None:
                        (photos / (item["photo"]["sha256"] + ".jpg")).write_bytes(jpg)
                    items.append(item)
                status = "verified" if all(item["status"] == "verified" for item in items) else "needs_replacements"
                result["cards"].append({"id": card["id"], "status": status, "items": items})
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--trusted-proxy", action="store_true", help="Use the environment's trusted HTTPS proxy")
    parser.add_argument("requests", type=Path, nargs="+")
    args = parser.parse_args()
    for path in args.requests:
        result = preflight(path.read_bytes(), path.stem, args.output, Downloader(use_proxy=args.trusted_proxy))
        print("MODA_PHOTO_PREFLIGHT " + json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
