# Orbital

## Executar no Windows

**[Baixar instalador Orbital 0.1.1 para Windows x64 (.exe)](https://github.com/DunDao0/Orbital/releases/download/v0.1.1/Orbital-0.1.1-Setup-x64.exe)** · [Ver versões disponíveis](https://github.com/DunDao0/Orbital/releases)

Esta é uma versão preliminar, em desenvolvimento. O instalador inclui o código e cria atalhos; a primeira abertura precisa de internet para baixar os componentes adicionais.

Para usar o Orbital, você precisa de **Windows 10/11 de 64 bits em um computador Intel ou AMD**, um navegador com suporte a gráficos 3D, internet durante a primeira instalação e uma pasta sua para guardar o projeto. Reserve pelo menos **4 GB livres como margem inicial**. O instalador atual não atende Windows ARM, macOS ou Linux.

**Não é necessário instalar Python ou Node.js por conta própria.** O instalador baixa as versões necessárias dentro da pasta do Orbital: Python faz os cálculos astronômicos; Node.js executa a interface que você verá no navegador. As bibliotecas e os dados astronômicos também são preparados automaticamente. Git e Docker não são necessários para esse procedimento; o Windows PowerShell utilizado pelo instalador já vem no Windows.

Baixe **`Orbital-0.1.1-Setup-x64.exe`** pelo link acima, abra o arquivo e clique em **Instalar**. Mantenha a pasta sugerida e a opção **Abrir o Orbital após a instalação**. Aguarde a janela de preparação concluir os downloads e mostrar **`Pronto: http://127.0.0.1:3000`**. O navegador será aberto; se isso não acontecer, digite esse endereço nele. Não é necessário extrair ZIP, digitar comandos nem executar como administrador. Nas próximas vezes, use o atalho do menu Iniciar ou da área de trabalho.

Para encerrar, use **Parar Orbital** no menu Iniciar ou **`Parar-Orbital.cmd`** na pasta instalada. Para remover, use **Configurações → Aplicativos**; dados locais e arquivos modificados são preservados. Veja o [manual do assistente](docs/instalador-exe-windows.md). O `.exe` ainda não é assinado e não inclui todos os componentes para uso offline; a [distribuição ZIP](https://github.com/DunDao0/Orbital/releases/download/v0.1.1/Orbital-0.1.1-Windows-x64.zip) continua disponível como alternativa.

## Resumo

**Orbital** é uma plataforma científica interativa em desenvolvimento que reúne exploração do Sistema Solar em 3D, simulação de movimento orbital, atlas planetário e consultas do céu a partir de um observador na Terra. A proposta é conectar a experiência visual aos dados e cálculos que a sustentam, permitindo explorar corpos celestes, compreender suas relações espaciais e consultar informações astronômicas com contexto físico explícito.

A plataforma combina estados de referência obtidos de efemérides, catálogos de estrelas e satélites naturais, limites oficiais de constelações e integração gravitacional de múltiplos corpos. A exploração abrange tanto a visão do Sistema Solar quanto a perspectiva de um observador definido por latitude, longitude, elevação e instante UTC. Os recursos de céu local e análise de eclipses dependem do backend científico e da disponibilidade e validade das fontes necessárias.

O desenvolvimento prioriza rastreabilidade e clareza: cada resultado deve conservar sua origem, época, referencial e método, distinguindo dados de referência, resultados de simulação e adaptações visuais. Ajustes de câmera, tamanho e escala facilitam a exploração sem modificar os valores físicos. Quando os dados estão ausentes, vencidos ou fora de cobertura, a aplicação deve informar essa condição, com limites de precisão explícitos.

O projeto parte da base **Orbis Scientia**, nome ainda presente em módulos e na documentação técnica, e está em desenvolvimento e validação locais. Seu objetivo é servir como ambiente de exploração, estudo e investigação computacional de fenômenos astronômicos; a visualização e os cálculos disponíveis não representam, por si só, uma ferramenta operacional de previsão validada.

## Summary

**Orbital** is an interactive scientific platform under development that brings together 3D Solar System exploration, orbital motion simulation, a planetary atlas, and sky queries from an observer's location on Earth. It aims to connect the visual experience with the underlying data and calculations, enabling users to explore celestial bodies, understand their spatial relationships, and examine astronomical information with explicit physical context.

The platform combines ephemeris-based reference states, star and natural satellite catalogs, official constellation boundaries, and gravitational integration of multiple bodies. Exploration spans both a Solar System view and the perspective of an observer defined by latitude, longitude, elevation, and a UTC instant. Local sky and eclipse analysis features depend on the scientific backend and on the availability and validity of the required data sources.

Development prioritizes traceability and clarity: each result should retain its source, epoch, reference frame, and method, distinguishing reference data, simulation results, and visual adaptations. Camera, size, and scale adjustments support exploration without modifying physical values. When data is missing, outdated, or outside its coverage, the application should report that condition and make precision limits explicit.

The project builds on **Orbis Scientia**, a name still used in modules and technical documentation, and is undergoing local development and validation. Its goal is to provide an environment for exploration, study, and computational investigation of astronomical phenomena; the available visualizations and calculations do not, by themselves, constitute a validated operational prediction tool.

## Estado do projeto

Em desenvolvimento e validação locais. A versão preliminar 0.1.1 está disponível em [Releases](https://github.com/DunDao0/Orbital/releases/tag/v0.1.1). O fluxo de instalação Windows prepara os componentes necessários a partir do código-fonte; os dados científicos mantêm suas verificações de integridade e cobertura.

## Recursos em desenvolvimento

- **Sistema Solar em 3D:** exploração de corpos celestes, órbitas e escalas visuais.
- **Simulação orbital:** integração N-body com Velocity-Verlet e unidades físicas explícitas.
- **Atlas planetário:** navegação e inspeção visual de planetas e da Terra.
- **Céu local:** consultas para um observador definido por localização, elevação e instante UTC.
- **Constelações e catálogos:** referências de estrelas, satélites naturais e limites oficiais de constelações.
- **API científica:** estados de referência, catálogos e operações dependentes do backend científico.

A disponibilidade de cada operação depende das fontes de dados, da cobertura temporal e dos serviços locais necessários.

## Compromissos científicos

- Preservar posições, velocidades, parâmetros gravitacionais, época e referencial fornecidos pelo cálculo científico.
- Manter ajustes de câmera, tamanho e escala exclusivamente na camada visual.
- Identificar a origem dos dados e distinguir estados de referência de simulações.
- Não apresentar elementos médios de catálogo como posições observadas de luas.
- Informar dados ausentes, vencidos ou fora de cobertura, sem inventar resultados substitutos.

## Tecnologias

| Camada | Tecnologias |
| --- | --- |
| Interface e visualização | React, TypeScript e Three.js |
| Ferramentas do frontend | Vite e Vinext |
| Backend científico | Python, FastAPI e Astropy |
| Efemérides e referências | JPL DE442s/SPICE, Gaia DR3 e limites de constelações IAU |

## Limitações atuais

O projeto não deve ser interpretado como um previsor operacional validado. Cálculos de eclipses têm limitações de método e precisão; operações de observação dependem da validade das tabelas IERS e da cobertura das efemérides. Uma representação visual não comprova precisão física.

O desenvolvimento e a validação atuais são locais. O [manual de instalação](docs/instalacao-windows.md) descreve a execução no Windows e seus limites. O instalador não publica a API nem desativa restrições científicas para tornar uma consulta disponível.

## Próximas etapas

- Validar o pacote em uma extração nova e no computador de destino.
- Manter fontes, versões, limitações e documentação de instalação atualizadas.
- Validar frontend, tipos e backend antes de distribuir novas versões.
- Publicar alterações somente após autorização do proprietário.
