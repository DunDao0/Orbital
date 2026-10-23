# Atlas Orbital — fase C

## Missões

`MissionManifest` valida agência, referencial espacial, escala de tempo, alvos, marcos, cobertura e fontes. A Apollo 11 é um manifesto histórico com UTCs publicados pela NASA. Sem bundle de trajetória 3D, o referencial espacial é explicitamente `not-applicable/no-trajectory`: acompanhar espaçonave, posição e velocidade ficam indisponíveis e o relógio não extrapola a cobertura. As rotas públicas de dados são `/missions`, `/missions/apollo-11` e `/events`; nenhuma delas cria canvas.

## Eventos

`OrbitalEvent` é normalizado antes de ser mostrado. Os filtros atuam em categoria, UTC e alvo. Cada resultado apresenta fonte e limitações. Não há geometria inferida no navegador.
