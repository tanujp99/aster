# Photo Sphere capture

## On the phone

1. Open img.tanujp.com, go to **Photo Sphere**, and tap **Start capture**. Allow the camera and motion sensors (iOS asks separately).
2. Hold the phone upright (portrait) and turn on the spot. Rotate around the phone, not your body, to reduce parallax.
3. Line the centre ring up with each amber dot. When it turns green and you hold still, it shoots automatically.
4. Capture the middle ring first, then tilt up and down for the upper and lower rings, then the two poles.
5. Tap **Done**. Then either:
   - use **Stitch preview here** for a quick sensor-placed sphere on the phone, or
   - use **Export frames (.zip)**, unzip it on your computer, and open the folder under **Stitch photos**. With the local helper running, Hugin aligns the frames precisely.

**Camera width (°)** is the horizontal field of view of the phone's camera stream. It's about 50–55° on most phones in portrait. If the dots don't line up with what you see, adjust it. The helper corrects small errors anyway.

## Photos shot by hand

Shoot overlapping frames covering the whole sphere, with about 30% overlap and rows at roughly 0° and ±45°, plus straight up and down. Then go to **Photo Sphere → Stitch photos**, pick them, and stitch with the local helper. Hugin's multirow matching works out the layout from the images. Manual photos have no orientation data, so a browser-only stitch isn't available for them.

## Output

The output is an equirectangular JPEG (2:1) with GPano XMP. Google Photos, Facebook, and Aster's own viewer show it as an interactive sphere.
