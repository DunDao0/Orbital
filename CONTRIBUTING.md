# Como contribuir com o Orbital

O repositório oficial é [DunDao0/Orbital](https://github.com/DunDao0/Orbital), mantido por **@DunDao0**. Qualquer pessoa pode consultar o conteúdo público e baixar o código. Para abrir uma issue, criar um fork ou enviar uma pull request pelo GitHub, use uma conta GitHub.

## Consultar, baixar e experimentar

Use **Code → Download ZIP** para obter o código. As instruções de instalação estão no [README](README.md#instalar-e-abrir-no-windows).

Um fork é uma cópia em outra conta: você pode preparar sua proposta nessa cópia sem modificar o repositório oficial. Abrir uma issue, enviar commits ao fork ou abrir uma pull request não altera a branch `main` do Orbital.

## Sugerir uma melhoria sem escrever código

1. Consulte as [issues existentes](https://github.com/DunDao0/Orbital/issues) para verificar se a ideia já está sendo discutida.
2. Abra uma [nova issue](https://github.com/DunDao0/Orbital/issues/new/choose) usando o modelo **Sugestão ou problema**.
3. Explique o objetivo, o comportamento atual e o resultado esperado. Em problemas, descreva como reproduzir e informe o ambiente utilizado.

O mantenedor poderá pedir mais informações, aceitar a ideia, propor outra abordagem ou encerrar a sugestão. Uma issue aberta não equivale a uma aprovação de implementação.

## Propor uma alteração no código

1. Faça um fork e crie uma branch para uma mudança de escopo definido.
2. Consulte `AGENTS.md`, o README e a documentação da área que será alterada.
3. Implemente a mudança na sua cópia e execute as verificações pertinentes.
4. Abra uma pull request do seu fork para a branch **`main`** de **`DunDao0/Orbital`**.
5. Descreva o problema, a solução, os testes e as limitações. Aguarde a revisão do mantenedor e responda aos pedidos de ajuste.

Os arquivos `.github/CODEOWNERS` designam **@DunDao0** como responsável por todos os caminhos, incluindo as próprias regras de contribuição. A proteção da `main` exige aprovação do responsável para propostas de colaboradores; novos commits invalidam aprovações anteriores. Conversas de revisão devem estar resolvidas antes da integração, e o merge automático está desabilitado.

**Somente o mantenedor tem acesso de escrita neste momento.** Sua aprovação não concede ao autor da proposta permissão para fazer push ou merge. O mantenedor integra a proposta quando decidir, ou faz a alteração diretamente como proprietário. A conta proprietária conserva a exceção administrativa para efetuar suas próprias mudanças. Adicionar outros administradores no futuro também lhes daria poderes de administração, por isso essa permissão não faz parte do fluxo de contribuição pública.

## Verificações antes da revisão

Para alterações no frontend, execute os comandos definidos pelo projeto:

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run lint
```

Para o ambiente científico de desenvolvimento já preparado:

```powershell
backend\.venv\Scripts\python.exe -m pytest backend\tests -p no:cacheprovider -ra
```

O ambiente instalado pelo launcher Windows é separado da `.venv` de desenvolvimento. Consulte [instalação](docs/instalacao-windows.md) e [Docker](docs/docker-scientific-services.md) para os ambientes e gates completos com SPICE. Não apresente testes ignorados ou testes locais como prova de execução completa em outro ambiente.

Mudanças exclusivamente documentais exigem revisão de conteúdo, comandos, links e formatação; não é necessário iniciar serviços para corrigir um texto. Os comandos acima são orientações de validação: não existe um workflow de CI configurado neste repositório nesta etapa.

## Contratos científicos e dados

- Preserve unidades SI, posição, velocidade, parâmetros gravitacionais, época, referencial e os contratos de resposta do backend.
- Mantenha escala, câmera e tamanhos de apresentação na camada visual.
- Não apresente elementos médios de catálogo como posições observáveis de luas.
- Não desative verificações de integridade, cobertura ou validade IERS para fazer uma consulta passar.
- Não normalize bytes de arquivos científicos protegidos por `.gitattributes`: seus hashes fazem parte da verificação.
- Separe evidências de teste automatizado, inspeção visual, runtime e implantação. Registre os limites da mudança.

Não envie ambientes virtuais, `node_modules`, arquivos `.env`, credenciais, logs pessoais, kernels baixados ou caches. Use os manifestos e os procedimentos de dados documentados no projeto.

## Controle da versão oficial

O acesso público permite acompanhar o trabalho e preparar propostas. A decisão final sobre a `main` continua com **@DunDao0**. Forks e cópias locais têm seus próprios conteúdos e não representam uma alteração, aprovação ou publicação oficial do Orbital.
