# Serviço científico local

O FastAPI/Astropy/SPICE roda no computador do operador e fica deliberadamente
preso em `127.0.0.1:8000`. Não publique essa porta no roteador nem a exponha
diretamente à internet.

## Estado local atual

O fluxo atual é exclusivamente local. Nenhum deploy, publicação de porta ou
túnel foi criado por esta implementação. O bloco sobre uma implantação futura
é documental e não deve ser usado para substituir o serviço local nem para
expor `127.0.0.1:8000`.

## Iniciar e verificar localmente

Em PowerShell, a partir da raiz do projeto:

```powershell
scripts\start_science_api.ps1
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/health/ready
Invoke-RestMethod http://127.0.0.1:8000/api/capabilities
```

O script usa `--host 127.0.0.1 --no-access-log`, detecta uma instância Orbis já
ativa e falha de forma explícita quando outro processo ocupa a porta. O
computador precisa permanecer ligado enquanto cálculos ao vivo forem usados.

As operações canônicas de observador e simulação usam POST JSON. Coordenadas
não aparecem na URL e o middleware de aplicação não registra query ou corpo.
Respostas dinâmicas usam `private, no-store` e um `X-Request-ID` sanitizado.

## Possível conexão futura, fora do fluxo atual

O site possui um ponto de ligação opcional chamado `science_api`. Quando a
plataforma registrar um túnel HTTP privado para este computador, a implantação
receberá o binding `CUSTOMER_HTTP_SCIENCE_API`. Apenas as rotas abaixo serão
encaminhadas pelo Worker para o FastAPI local:

- `/api/sky`
- `/api/eclipses/local`
- `/api/simulate`

Nenhum binding ou túnel foi configurado nesta fase. Se estiver ausente, as
rotas retornam um erro explícito em vez de
fabricar cálculos. Os snapshots e catálogos publicados continuam funcionando
independentemente do computador local.

## Contrato público de capacidade

`GET /api/capabilities` permite que a interface decida quais ações científicas
podem ser oferecidas sem revelar endereços, nomes de bindings, portas ou outra
topologia privada. A resposta contém somente a versão/época do snapshot, o
intervalo UTC válido e booleanos para `catalogs`, `sky`, `eclipses_local` e
`simulate`.

Quando uma operação ao vivo não estiver disponível, `/api/sky`,
`/api/eclipses/local` e `/api/simulate` respondem `501` com o contrato estável:

```json
{
  "error": {
    "code": "SCIENCE_SERVICE_UNAVAILABLE",
    "capability": "sky",
    "message": "Cálculos científicos ao vivo não estão disponíveis neste ambiente."
  }
}
```

O cliente não calcula posições, céu ou eclipses como fallback. Ele preserva o
último resultado confirmado e informa a indisponibilidade de modo explícito.
Respostas dinâmicas usam `Cache-Control: private, no-store`.

## Limites de segurança

- Mantenha o FastAPI no loopback (`127.0.0.1`), como no script.
- No fluxo atual, não crie túnel nem publique a porta.
- Se uma fase futura autorizar conexão remota, use somente um canal privado
  revisado; nunca um URL público temporário.
- Não armazene token, credencial ou arquivo de túnel no repositório.
- O Worker continua sendo o único componente exposto ao navegador.
