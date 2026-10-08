# 🖥️ Raio-X do Computador

> Um painel web que mostra, em tempo real e em linguagem simples, tudo o que há dentro da máquina que roda o servidor: sistema operacional, processador, memória, discos, GPU, rede, temperaturas, consumo de energia e processos em execução.

## 🔗 Acesse o site

**👉 [https://so-tarefa.onrender.com/](https://so-tarefa.onrender.com/)**

> ⏳ O servidor está hospedado no [Render](https://render.com). Dependendo do plano, ele "dorme" após um período sem acessos, então o primeiro carregamento pode levar alguns segundos.

---

## 📌 Sobre o projeto

Este projeto foi desenvolvido na disciplina de **Sistemas Operacionais** (ADS, FATEC Itapetininga). A ideia é usar o Node.js e o Express para ler dados reais do sistema operacional e apresentá-los de um jeito que **qualquer pessoa consiga entender**, não só quem é da área.

Cada seção da página explica o que aquela peça faz. A RAM, por exemplo, é descrita como a "mesa de trabalho" do computador.

> ⚠️ **Importante:** o painel mostra os dados da **máquina onde o servidor está rodando**. No site publicado, isso significa o servidor do Render, e não o computador de quem acessa. Para ver o seu próprio computador, rode o projeto localmente (veja abaixo).

---

## ✨ O que o site mostra

### Resumo e diagnóstico
Cartões com o estado geral da máquina (processador, memória, armazenamento, temperatura, bateria e processos). Cada um traz um selo **Tudo certo**, **Atenção** ou **Crítico** e uma frase curta explicando a situação.

### Sistema e hardware
- Sistema operacional, nome do computador, usuário, tempo ligado, arquitetura, kernel, fuso horário e idioma
- Fabricante, modelo, placa-mãe e BIOS
- Processador com uso total e uso por núcleo
- Memória RAM
- Discos com espaço total, usado e livre
- Placa de vídeo, bateria, rede e portas abertas

### Detalhes avançados da máquina
| Área | Informações |
|---|---|
| **Processador** | Soquetes, núcleos físicos, threads, threads por núcleo, frequência atual, máxima e mínima, caches L1, L2 e L3, virtualização |
| **GPU** | Uso, VRAM usada e total, temperatura, consumo em watts, clocks, ventoinha, driver |
| **Memória** | RAM disponível, cache, buffers, memória compartilhada, swap e pentes (slot, tamanho, tipo, velocidade) |
| **Energia** | Consumo da CPU, da GPU e da bateria |
| **Temperaturas** | CPU, GPU e todos os sensores encontrados |
| **Extras** | Ventoinhas (RPM) e tráfego de rede em tempo real |

> Alguns itens dependem do sistema operacional, do hardware e das permissões do servidor. Quando não há como ler um dado, ele é omitido ou aparece como "indisponível". Em servidores na nuvem, por exemplo, é normal não haver GPU nem sensores de temperatura.

### Processos em execução
Tabela com **PID, programa, usuário, uso de CPU, memória, threads, estado e tempo ativo**, com busca por nome, usuário ou PID e ordenação por memória, CPU ou PID. Os estados aparecem traduzidos, como "Dormindo (normal)" e "Travado (zumbi)".

---

## 🎨 Visual

- Tema **escuro e moderno**, inspirado em landing pages de tecnologia
- Topo com anel de uso da CPU em tempo real
- Menu fixo com efeito de vidro e rolagem suave
- Cartões com degradê, bordas sutis e barras de progresso coloridas
- Atualização automática a cada **3 segundos**, sem recarregar a página

---

## 🛠️ Tecnologias

- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- Módulos nativos `os`, `fs` e `child_process`
- HTML, CSS e JavaScript puros no front-end (sem frameworks)

---

## 🚀 Como rodar localmente

```bash
# 1. Instale as dependências
npm init -y
npm install express

# 2. Inicie o servidor
node server.js

# 3. Abra no navegador
# http://localhost:3000
```

A porta pode ser alterada pela variável de ambiente `PORT`:

```bash
PORT=8080 node server.js
```

---

## 🔌 API

Os dados completos também estão disponíveis em JSON:

| Rota | Descrição |
|---|---|
| `GET /` | Painel visual |
| `GET /api/all` | Todos os dados coletados: sistema, hardware, CPU, memória, GPU, discos, rede, portas, bateria, temperaturas e processos |

Exemplo: [https://so-tarefa.onrender.com/api/all](https://so-tarefa.onrender.com/api/all)

---

## ☁️ Publicação no Render

O projeto está publicado como um **Web Service** no Render, com estas configurações:

| Campo | Valor |
|---|---|
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node server.js` |

O Render define a variável `PORT` automaticamente, e o servidor já a utiliza.

---

## 🔒 Segurança

O painel expõe informações da máquina, como IPs, endereços MAC, usuário e portas abertas. Em um servidor público, vale colocar autenticação ou limitar quais dados são exibidos.

---

## 📁 Estrutura

```
.
├── server.js     # Servidor Express, coletores de dados e página do painel
├── package.json
└── README.md
