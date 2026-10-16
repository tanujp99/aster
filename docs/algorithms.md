# How the stitching works

## Panorama, browser engine (`web/src/engine/panorama.ts`)

The model is a camera rotating about its optical centre with one focal length and no lens distortion. Phone JPEGs are already distortion-corrected.

1. **Features:** ORB (5,000 keypoints) runs on frames downscaled to 1,400 px on the long side.
2. **Matching:** only shooting-order neighbours `(i, i+1)` are matched, plus `(i, i+2)` as a stiffener. Matches go through a Lowe ratio test (0.75), then a RANSAC homography (3 px) keeps the inliers.
   Matching only neighbours is deliberate. On mountain sweeps, all-pairs matching links look-alike ridgelines in frames that don't overlap, which scrambles the layout. This is exactly what happened with Hugin's default `cpfind` on the Rainier sets.
3. **Focal length:** a 1-D search over log(f) (a coarse scan, then golden-section refinement) minimises the rotation-only reprojection error across every pair. No EXIF is needed.
4. **Rotations:** each pair's relative rotation comes from Horn's quaternion method on the inlier rays. The rotations are chained, then refined with 10 rounds of chordal averaging using the `(i, i+2)` pairs.
5. **Horizon levelling:** horizontal wave correction, following OpenCV's `waveCorrect`, finds the up-vector perpendicular to all camera right-vectors. This removes the tilted "smile" a handheld sweep produces.
6. **Exposure:** gains come from the mean overlap brightness of neighbouring frames, are chained, normalised to the median frame, and clamped to 0.75–1.35. Colours are otherwise untouched.
7. **Render:** the cylindrical projection is done frame by frame at native resolution, scaled down only to stay under the memory cap (40, 80 or 160 MP) and the 32,000 px canvas limit. Each frame owns the columns between the midpoints to its neighbours, with a linear feather of 2% of the focal length across each seam. Rendering one frame at a time keeps memory at the output size plus one source frame.
8. **Crop:** column top and bottom profiles feed a search over left and right trims, which picks the largest fully covered rectangle.

## Panorama, local helper (`helper/aster/pipeline.py`)

This is the pipeline that produced the Rainier panoramas:

1. `pto_gen -p 1` creates a cylindrical project.
2. **Neighbour-only SIFT control points** come from OpenCV (8,000 features at half scale, ratio 0.7, RANSAC). Up to 60 points per pair are written into the `.pto`. If too few are found, it falls back to Hugin's `cpfind --linearmatch`.
3. `cpclean` removes outliers.
4. `autooptimiser -p -l` optimises positions only, starting from a neutral layout, before `-a -m -l -s` adds the lens, photometrics and size. If the full solve drifts (pitch spread above 35° or a non-monotonic yaw), the positions-only solution is kept.
5. **Roll levelling:** the whole-pano roll that minimises the variance of image-centre pitches is found by search, then applied with `pano_modify --rotate`. On Rainier 1 this recovered about 50% more frame height.
6. `pano_modify --canvas=AUTO --crop=AUTO` sets the canvas and crop, then `hugin_executor` renders with nona and enblend.

## Photo Sphere

The approach follows the old Pixel and Nexus Photo Sphere. Sensors give the starting layout and gravity; the images decide the exact placement.

1. **Capture** (`web/src/views/sphere.ts`): guide dots on rings at 0° and ±45° plus both poles. The phone auto-shoots when the centre ring is on a dot and the phone is still, and records the sensor rotation with each frame.
2. **Alignment** (`web/src/engine/sphereAlign.ts`):
   - ORB features are found on every frame, downscaled to 1,024 px.
   - Only frames whose sensor view directions are close enough to overlap get matched. This keeps look-alike walls and ceilings on opposite sides from being linked.
   - Matches go through a ratio test (0.75) and a RANSAC homography (4 px); a pure rotation is a homography. Each pair keeps at most 50 points.
   - **Bundle adjustment** then refines every frame's rotation plus one shared focal length, with Levenberg–Marquardt. It minimises the angle between matched rays under a Cauchy robust loss, plus a weak prior (σ = 3°) tying each frame to its sensor reading. The prior fixes the overall heading and keeps the horizon level from the accelerometer.
   - The camera width it measures is saved, so the next capture's dots line up.
   - Exposure is matched with the same gain solver as the panorama engine.
3. **Render** (`web/src/engine/sphere.ts`): the 6,144 × 3,072 equirectangular output only visits each frame's footprint. The weights are seam-style: the distance to the frame edge raised to the 6th power. The frame nearest the centre owns each pixel, and neighbours blend only in a narrow band, so people who moved between shots aren't doubled. A plain average of all overlapping frames is what produced the ghosting.
4. **Metadata**: a camera-style EXIF block (make, model, software, capture time, size; passes `exiftool -validate`) plus the full GPano block a Pixel writes. Both are needed before Google Photos and Facebook treat the file as a sphere.

**Synthetic test** (`web/scripts/test-sphere-align.mts`): 12 frames are shot from a known world, then their sensor readings are corrupted by about 4° and the lens width is guessed wrong (52° against a true 46°). After alignment, frames agree to 0.09° RMS, and the lens is recovered as 45.97°.

**Helper** (`stitch_sphere`): Hugin with `cpfind --prealigned` from the sensor layout, or `--multirow` for photos shot by hand. Then `autooptimiser`, a full 360 × 180 canvas, and enblend.

## Sensor maths (`web/src/capture/orientation.ts`)

DeviceOrientation gives `R = Rz(α)·Rx(β)·Ry(γ)` (device → Earth ENU). Converting it to the camera rotation:

```
C = EARTH_TO_WORLD · R · CAM_TO_DEVICE
EARTH_TO_WORLD: (E, N, U) → (x = E, y = −U, z = N)
CAM_TO_DEVICE : rear camera looks along −z, image y points down
```

Capture targets form three rings (0°, ±45° pitch) plus both poles, spaced at 68% of the camera width, which gives about 32% overlap.
