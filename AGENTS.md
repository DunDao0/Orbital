# Orbis Scientia — regras do projeto

- Preserve `position_m`, `velocity_m_s`, `mu_m3_s2`, integração Velocity-Verlet, época, referencial e respostas do backend como fonte física. Uma visualização jamais deve escrever nesses valores.
- Transformações de escala, posição exibida, tamanho, órbitas desenhadas e câmera vivem no frontend como adaptadores visuais declarados.
- Não desenhe luas sem uma fonte de estado explícita. Elementos médios de catálogo podem aparecer como metadados, nunca como posições observáveis.
- Valide alterações do frontend com `npm.cmd test` e `npx.cmd tsc --noEmit`; valide alterações científicas com `backend\\.venv\\Scripts\\python.exe -m pytest backend\\tests`.
- O fluxo solicitado atualmente é local: não publique, não crie túnel nem altere hospedagem sem pedido explícito.
