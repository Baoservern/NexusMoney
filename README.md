# Meu Dinheiro — WebApp/PWA

Site responsivo de finanças pessoais feito em HTML, CSS e JavaScript puro.

## Onde os dados ficam?

Os dados ficam no **IndexedDB do navegador do próprio dispositivo**. Não há servidor, conta, login ou nuvem nesta versão.

Isso significa:
- fechar e abrir o site mantém os dados;
- instalar como PWA mantém os mesmos dados daquele navegador/origem;
- outro celular ou outro navegador não recebe os dados automaticamente;
- limpar "dados do site" no navegador remove as informações;
- use **Contas > Exportar backup** para salvar um arquivo JSON antes de trocar de aparelho ou limpar o navegador.

## Recursos

- Dashboard mobile-first;
- saldo consolidado, entradas, saídas e saldo projetado;
- ocultar/exibir valores;
- receitas, despesas e transferências;
- transações futuras, parcelamento até 60x e recorrência mensal por 12 meses;
- contas separadas e cálculo de saldo por conta;
- gráfico de gastos por categoria;
- fluxo de caixa dos últimos 6 meses;
- tetos mensais por categoria;
- cofrinhos/metas;
- backup e restauração em JSON;
- PWA instalável e cache offline;
- nenhum framework ou CDN obrigatório.

## Como testar no PC

Não abra `index.html` dando dois cliques, porque módulos ES e Service Worker funcionam melhor via HTTP.

Com Python instalado:

```bash
python -m http.server 8080
```

Depois acesse `http://localhost:8080`.

## Como hospedar

A pasta inteira pode ser hospedada como site estático em GitHub Pages, Netlify, Cloudflare Pages, Vercel, Firebase Hosting etc. Não é necessário banco no servidor.

Para instalação como app/PWA e Service Worker, a hospedagem deve usar **HTTPS** (localhost é a exceção para desenvolvimento).

## Privacidade importante

IndexedDB é separado por **origem do site** (protocolo + domínio + porta). Se você mudar o domínio da hospedagem, o navegador tratará o novo endereço como outro armazenamento. Exporte o backup antes de migrar o domínio.
