# Physics and numerical scope

The basic acceleration is `a_i = Σ_{j≠i} μ_j (r_j-r_i) / |r_j-r_i|³`. There is no softening. Coincident centres throw an error and radius-overlap detection is available. The diagnostics report kinetic/potential/total energy, linear and angular momentum, and barycentre.

Velocity-Verlet is time reversible with a fixed step and is the default long-duration integrator. `dop853` delegates to SciPy and deliberately reports a missing dependency rather than pretending to be high order. J2, relativity, tides, radiation pressure and hierarchical moon substeps are not enabled in this release. Thus this N-body model is a Newtonian experiment, not a replacement for JPL ephemerides.

The DE fallback parser evaluates type-2 Chebyshev records only from the supplied DE442s file. It does not extrapolate. UTC→TDB/ET uses Astropy when SpiceyPy is absent; it no longer applies one fixed modern offset across the historical coverage. SpiceyPy remains the preferred full-SPICE path when installed.

The Atlas scene time is a requested display UTC. Advancing it does not
interpolate, predict or overwrite a DE442s reference state. A source outside
its declared coverage remains unavailable; no visual orbit, mean lunar element
or client-side astronomical approximation fills that gap.

## Fase G: identidade e integração

Os estados apresentados de Marte, Júpiter, Saturno, Urano e Netuno usam os
alvos 4, 5, 6, 7 e 8 do DE442s e são declarados como baricentros de sistema.
Sol, Mercúrio, Vênus, Terra e Lua usam centros físicos. `naif_id` permanece o
ID físico apresentado; `state_target_naif_id` identifica o alvo realmente
avaliado. Todos os vetores continuam J2000 em relação ao baricentro do Sistema
Solar, em metros e metros por segundo.

O N-body do navegador executa passo fixo de 3.600 s. O controle de velocidade
altera somente a quantidade de passos por atualização, limitado a 24. Uma
singularidade conserva o último estado finito e pausa; não há softening nem NaN
encaminhado à cena.
