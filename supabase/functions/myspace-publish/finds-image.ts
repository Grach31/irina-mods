import { ImageMagick, initializeImageMagick, MagickFormat } from 'npm:@imagemagick/magick-wasm@0.0.46';

let initialization: Promise<void> | undefined;

export async function webpToJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  initialization ??= Deno.readFile(
    new URL('x86/magick.wasm', import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.46')),
  ).then(initializeImageMagick);
  await initialization;
  return ImageMagick.read(bytes, image => {
    image.quality = 90;
    return image.write(MagickFormat.Jpeg, data => new Uint8Array(data));
  });
}
