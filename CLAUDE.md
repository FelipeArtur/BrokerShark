# BrokerShark — Guia para o Claude

## Visão Geral do Projeto

<!-- Descreva aqui o objetivo do projeto -->

## Arquitetura

```
brokershark/
├── backend/
│   ├── main.py       # Ponto de entrada
│   ├── bot.py        # Lógica do bot Telegram
│   ├── agent.py      # Agente de IA (Ollama)
│   ├── database.py   # Camada de dados
│   └── backup.py     # Rotinas de backup
├── data/             # Banco de dados SQLite (não versionado)
├── logs/             # Logs de execução (não versionados)
├── backups/          # Backups automáticos (não versionados)
├── .env              # Credenciais (não versionado — ver .env.example)
└── .env.example      # Template de variáveis de ambiente
```

## Stack

- **Linguagem:** Python
- **Bot:** python-telegram-bot
- **IA:** Ollama (local)
- **Banco de dados:** SQLite

## Como rodar

```bash
cp .env.example .env
# edite .env com suas credenciais
python backend/main.py
```

---

## Notas para o Claude

<!-- Seção livre: adicione instruções, contexto e preferências -->

### Comportamentos esperados

<!-- Ex: "Sempre use type hints", "Prefira funções pequenas", etc. -->

### Skills disponíveis

<!-- Liste aqui as skills do Claude Code relevantes para este projeto -->

### Decisões de design

<!-- Registre aqui decisões arquiteturais importantes e seus motivos -->

### Tarefas em aberto

<!-- Issues, melhorias ou débitos técnicos que o Claude deve ter em mente -->
