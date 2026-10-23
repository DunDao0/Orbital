# Data sources and provenance

The kernel bundle is fetched from NASA/JPL NAIF: `de442s.bsp`, `naif0012.tls`, and `pck00011.tpc`. SHA-256 values, retrieval time and byte sizes are written to `data/manifests/kernels.json`.

`scripts/update_moon_catalog.py` consumes JPL SSD physical-parameter and mean-element pages. The generated catalog has 460 records in this run: Earth 1, Mars 2, Jupiter 115, Saturn 291, Uranus 30, Neptune 16 and Pluto 5. Mean elements are saved for search/provenance only; they are not silently used to synthesize precision moon positions.

`scripts/build_star_catalog.py` used the ESA Gaia Archive DR3 TAP query recorded inside `data/stars/gaia_bright.json`: the first 10,000 sources with `phot_g_mean_mag <= 6.5`, with RA, Dec, G magnitude, proper motion and parallax. The full Gaia archive is intentionally not loaded in the browser.

The 88 constellation identifiers are IAU labels. `scripts/update_constellations.py` consumes Astropy's packaged IAU names list and Roman (1987)/Delporte boundary table (CDS VI/42), creates a formal shared-edge map in ICRS/J2000 and records the source checksum. The original table is classified in B1875; the output states this transformation explicitly. `constellation_guides.json`, `iau_boundary_vertices_j2000.json` and the legacy inventory are different artifacts. A project editorial Portuguese glossary is included only as a search alias and identifies itself as such; it is not a replacement source for IAU names or geometry. Cultural stick figures have no substitute source in this repository and are marked absent rather than confused with official boundaries. The local Gaia subset has no approved WGSN name cross-match, so `iau_named_stars.json` declares that absence instead of inferring names.

## Atlas visual references and local feature flags

`public/atlas/CREDITS.md` records the NASA mission and observatory references
that informed the procedural planet materials. No image, height map, texture
or 3D model from those sources is bundled or downloaded by the application.
The offline Earth Lab fixture is explicitly non-geographic and disabled by
`EARTH_LAB_FEATURE_FLAG`; it is a contract/cache test, not an observation.

Mission records expose NASA source links, UTC milestones and coverage. They do
not claim a spatial frame or trajectory when no approved trajectory bundle is
present. The stored value `not-applicable/no-trajectory` is an explicit absence
of position data, never a computed fallback.

## Integridade e timestamps da Fase G

Os SHA-256 de kernels permanecem pins revisados no código e no manifesto; o
script não aprende um hash novo do download. `obtained_utc` só muda quando há
download aceito. `verified_utc` registra uma verificação local e
`manifest_generated_utc` registra a geração do manifesto. Arquivo existente e
válido não recebe uma aquisição fictícia.

`data/manifests/offline_catalogs.json` relaciona cada origem à cópia em
`public/scientific`, com os dois hashes. O validador offline exige 3 kernels,
460 luas, 10.000 estrelas, 88 constelações, abreviações únicas e 10 corpos com
vetores finitos no snapshot. Aquisição usa `.part`, valida tamanho, assinatura
e hash antes de `os.replace`; geração de manifesto e cópias também é atômica.
