# Política temporal comum aos leitores DE442s

## Causa da divergência

O teste original comparava a interpretação UTC do Astropy/ERFA com `str2et`
do SPICE em 1965 como se fossem a mesma convenção. A documentação NAIF explica
que sua conversão UTC histórica não representa as variações na duração do
segundo anteriores a 1972. A divergência observada foi de aproximadamente
5,4598975 s; não era falta de potência do computador nem problema de instalação.

O problema também afetava o código: o backend verificava a cobertura com o ET
calculado pelo Astropy e depois reinterpretava a string UTC pelo SPICE. Assim,
instalar SpiceyPy podia mudar o instante físico consultado.

## Contrato

1. A interpretação pública de UTC permanece a existente: Astropy/ERFA.
2. `epoch_metadata` converte uma vez para segundos TDB desde J2000.
3. A cobertura DE442s e ambos os leitores usam exatamente esse mesmo número.
4. O leitor SPICE recebe o ET numérico em `spkezr`, sem chamar `str2et` novamente.
5. O snapshot declara `utc_to_tdb_provider` e `utc_policy` em `epoch_metadata`.

Não adicionamos offsets empíricos, extrapolação de kernels ou conversores próprios.
Valores SI, referencial J2000, centro e integração Velocity-Verlet permanecem
inalterados. Astropy não passa a garantir precisão histórica absoluta por esta
correção; permanecem suas convenções, cobertura e avisos ERFA para épocas duvidosas.
Atualizações futuras de tabelas de tempo devem ser validadas com as imagens/dados.

## Precisão numérica e serialização UTC

A conversão usa as duas partes do dia juliano Astropy (`jd1`, `jd2`) antes
de subtrair J2000. Somar primeiro as partes em um único `float` perdia dezenas
de microssegundos nas datas modernas. A conversão inversa também fornece J2000
e o deslocamento separadamente ao Astropy, sem somá-los antecipadamente.

O contrato de entrada admite até seis casas decimais. A string UTC canônica
preserva essa resolução, incluindo offsets e segundos intercalares. Strings
legadas mantêm ao menos três casas: `.000000Z` continua sendo `.000Z`, enquanto
`.000499Z` não é mais reduzido a `.000Z`. A saída tem no máximo seis casas;
segundos ET continuam sendo um `float`, com a resolução finita correspondente.
Resolução de representação não é uma alegação de exatidão astronômica absoluta.

A simulação e sua validação no gateway compartilham `advance_utc`, que adiciona
segundos SI com `TimeDelta` e conserva os microssegundos na época final. Isso
não muda o integrador nem introduz correção física empírica. Ao recuperar a
época antes truncada, os últimos dígitos dos vetores podem mudar porque o kernel
passa a ser consultado no instante solicitado corretamente representado.
As verificações de cobertura continuam estritas, sem extrapolação.

## Regressões

- Conversão TT → TDB pelo SPICE (`unitim`) comparada ao Astropy no mesmo instante,
  incluindo 1965, com tolerância absoluta de 1 ms e tolerância relativa zero.
- Comparação direta de strings UTC modernas com `str2et`, também a 1 ms.
- Diferença histórica de 1965 explicitamente testada, não removida nem tolerada
  como erro pequeno. A comparação original misturava convenções diferentes.
- Mesma época numérica nos leitores SPICE e DE442s puro para 1965, início de 1972,
  segundo intercalar de 2016 e 2026; vetores comparados a 1 mm e 1 µm/s.
- Uma regressão impede que a consulta SPICE volte a reinterpretar UTC.
- Canonicalização com seis casas, offsets, segundos intercalares e compatibilidade
  das strings antigas; ida e volta UTC/ET dentro da resolução numérica declarada.
- Ambos os leitores recebem o mesmo ET em consultas submilissegundo. Integração
  real `science` → `orbital` verifica consulta de estado e simulação, incluindo
  duração fracionária, integração reversa e passagem pelo segundo intercalar.
- Os limites UTC anunciados pelo DE442s são aceitos; consultas um microssegundo
  além deles continuam retornando indisponibilidade por cobertura.

## Referências

- [NAIF: limitações de UTC anterior a 1972](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/utc2et_c.html).
- [NAIF: conversão entre escalas uniformes com unitim](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/unitim_c.html).
- [Astropy: escalas e conversões de tempo](https://docs.astropy.org/en/stable/time/index.html).
