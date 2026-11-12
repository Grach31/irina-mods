"""Safely receive PWA moderation approvals through GitHub Actions OIDC.
No public write access to GitHub state, and no bot token is sent to the browser.
"""
import json
import os
import urllib.request
import urllib.parse
import urllib.error

API = "https://rjnfokknhjmtuzturvub.supabase.co/functions/v1/myspace-pwa"

def _call(action, **kwargs):
    req_url = os.getenv("ACTIONS_ID_TOKEN_REQUEST_URL")
    req_token = os.getenv("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not req_url or not req_token:
        return None
    sep = "&" if "?" in req_url else "?"
    req = urllib.request.Request(
        req_url + sep + "audience=" + urllib.parse.quote("stambo-pwa-actions"),
        headers={"Authorization": "bearer " + req_token})
    with urllib.request.urlopen(req, timeout=12) as r:
        oidc = json.load(r)["value"]
    req = urllib.request.Request(API, data=json.dumps({"action": action, **kwargs}).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + oidc},
        method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)

def pending():
    return (_call("bot_pending") or {}).get("actions", [])

def acknowledge(ids):
    if ids:
        _call("bot_ack", ids=ids)
