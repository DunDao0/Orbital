# Atlas Orbital — fase E

O assistente usa somente `OrbitalAssistantContext`: experiência, alvo, UTC solicitado, câmera, seleção e camadas visíveis. O contexto não possui latitude, longitude, elevação, credenciais nem acesso direto ao renderer.

Nesta versão não há provedor de IA configurado. Há respostas locais determinísticas para camadas e Terra/Lua; perguntas que exigem cálculo científico, efemérides ou dados externos retornam `indisponível` e não estimam valores. Ações permitidas retornam um novo estado de cena, que o controlador aplica.
