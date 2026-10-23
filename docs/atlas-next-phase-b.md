# Atlas Orbital — fase B

## Medições e comparação

- Medições geodésicas usam a solução inversa de Vincenty no elipsoide WGS84.
- Medições espaciais usam exclusivamente vetores `position_m` e `velocity_m_s` presentes no snapshot. Na ausência deles, a interface mostra `indisponível`.
- A distância de tela nunca é uma medida física. O comparador usa dois viewports `scissor` do único `WebGLRenderer` já existente: **referência relativa** e **ampliação visual**. Modos sem uma representação distinta não são oferecidos.
- Vista de câmera e camadas visuais vêm do mesmo `OrbitalSceneStateV1`; um fragmento de URL restaurado reaplica atmosfera, nuvens, grade, marcador e vista de superfície no canvas.

## Jornadas

As três jornadas são manifestos locais, com transcrição e fontes. Cada etapa contém uma `OrbitalSceneStateV1`; iniciar, avançar ou sair aplica esse estado pelo controlador de cena. Não há cálculo ou movimento automático.

## Projetos

Projetos são locais, versionados como schema 1 e exportados em `.orbis.json`. A importação limita o arquivo a 500 kB, valida cada cena, remove os caracteres de marcação de texto e rejeita schemas desconhecidos. A localização do observador não faz parte do schema.
