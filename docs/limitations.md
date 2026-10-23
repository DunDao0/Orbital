# Limitations and next work

- DE442s supplies planetary/lunar states; satellite SPK kernels (JUP/SAT/URA/NEP) are not bundled. All 460 catalog moons are searchable, but only the Moon is presently available as an exact displayed state.
- The UI's giant-planet offline fallback uses DE planetary barycentre state and labels this in the JSON. Install SpiceyPy to use general SPICE lookup.
- The FastAPI/Astropy/SciPy development environment is validated locally. The frontend Worker cannot execute the Python/Astropy/SPICE stack itself, so without a scientific service it exposes only fixed reference data and catalogues. The Windows launcher starts that native Python service locally; a remote deployment requires a separately configured scientific service.
- The WebGL scene uses actual DE442s state-vector directions through an explicit visual-scale adapter. It can display proportional, compressed and focus views; marker radii and focus amplification are deliberately nonphysical UI aids. Osculating Keplerian paths are derived from the current state only and are not future ephemerides. Of the 460 catalogued moons, only bodies with a named reference state belong in the 3D scene; the remaining JPL mean-element records are searchable metadata, not visual ephemerides.
- There is no satellite-kernel interpolation cache, J2 model, relativity, hierarchical moon integrator, ring orientation model, cultural constellation artwork, or global eclipse-shadow map yet.
- The screen visualization has intentionally exaggerated/logarithmic geometry; it is not an astrometric chart or to-scale camera.
- `/missions`, `/missions/apollo-11` and `/events` are descriptive data routes.
  They do not create a WebGL scene, invent mission trajectories or infer event
  geometry in the client.
- The Earth Lab has no approved terrain or temporal raster provider. Its
  ellipsoid fallback has zero observed elevation and the disabled fixture must
  not be interpreted as a geographic layer.
- The constellation observatory renders only the precomputed, magnitude-limited
  Gaia DR3 subset and formal IAU/Roman–Delporte region boundaries. It is not a
  complete sky survey, an astrometric plotting package, a cultural-asterism
  catalogue or a future-observability predictor. AltAz appears only after a
  native Astropy calculation for the explicit WGS84 observer and UTC.
- Gaia G magnitude is not identical to human visual magnitude; rendered point
  size and opacity are nonphysical readability aids, never stellar radii.
- The constellation planning screen does not model weather, clouds, light
  pollution, terrain, local obstructions, refraction (disabled here), sky
  brightness or user equipment. It is a geometric educational aid only.
- Proper motion is left unapplied when the subset lacks a sufficient
  astrometric state; no radial velocity or distance is invented. Historical
  content and official star-name cross-matches may remain incomplete.
- “Parts of continents” is not emitted without a licensed geographic derived
  dataset. Declination-derived latitude ranges are geometric potential, not
  a continent-wide observing guarantee. The visualization is not an
  astrometric instrument.

## Limitações mantidas após a Fase G

DE442s não é extrapolado. Gigantes usam baricentros do sistema 4–8; isso não é
o centro físico de cada planeta. Somente a Lua possui estado exato exibível
entre as luas catalogadas; elementos médios não são observáveis. O N-body
continua newtoniano de massas pontuais, sem J2, relatividade, marés, pressão de
radiação ou hierarquia de luas. DOP853 não é público e o navegador ainda não
usa Web Worker. Órbitas desenhadas são osculantes e toda amplificação é visual.

Céu local opera sem refração e horizonte geométrico não garante visibilidade;
clima, luz, relevo, obstruções e equipamento não são modelados. Eclipse é uma
busca candidata, não predição Besseliana operacional. O Worker não calcula
astronomia e o backend local deve permanecer ligado para operações dinâmicas.
Um binding futuro pode estar configurado sem estar saudável. GET legado com
coordenadas é menos privado e não é usado pelo frontend. O subconjunto Gaia não
é o céu completo e o Atlas permanece procedural.
