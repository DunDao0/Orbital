# Atlas Orbital — fase D

## Earth Lab

`EarthTemporalLayerManifest` contém fonte, licença, data, cobertura, legenda, resolução, atribuição e limitações. A única camada entregue é uma fixture local não geográfica, atrás de `EARTH_LAB_FEATURE_FLAG = false` para dados externos. O loader é sob demanda, cancelável, LRU e descartável.

## Superfície

O modo de superfície continua no canvas, renderer e loop existentes. Para a Terra, a geometria de aproximação usa o fallback elipsoidal sem deslocamento de elevação. `TerrainProvider` e `TerrainTileCache` estão preparados para um dataset futuro autorizado; o provider atual retorna `null` e declara a limitação.
