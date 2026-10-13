# Contorno

Aplicativo em português para rastrear o limite externo de formas em imagens, visualizar a seleção e exportar contornos vetoriais. Funciona inteiramente no navegador, sem enviar os arquivos a servidores.

## Usar no computador, offline

Baixe `contorno-offline.zip` no GitHub e extraia, ou use **Salvar app offline** no cabeçalho do aplicativo aberto. Os links de artefatos do chat podem falhar; essas opções usam download direto. Também pode usar **Code → Download ZIP** no repositório. Abra `index.html` ou `contorno-offline.html` com um navegador atualizado (Chrome, Edge ou Firefox). O arquivo inclui o aplicativo, o leitor de PDF, seu worker e a biblioteca de exportação. Não precisa de Node, instalação, CDN ou conexão à internet.

1. Clique em **Importar arquivo** (ou arraste para a área de visualização).
2. Escolha o método e ajuste os sliders. Use a aba **Seleção** para conferir a área que será traçada.
3. Corrija com **Área**, **Adicionar** e **Remover**. Há **Desfazer** e **Limpar correções**.
4. Defina a **Largura física da imagem** e ajuste **Deslocamento do contorno** em milímetros. Valores positivos expandem e unem formas próximas; negativos encolhem. Para envolver todas as formas em uma silhueta, marque **Contorno geral do conjunto**. Depois ajuste **Simplificar pontos** e **Suavizar curvas**. **Mostrar pontos** ajuda a conferir o resultado.
5. Escolha a largura em milímetros, a cor e a espessura da linha. Exporte PDF ou SVG com **Imagem + contorno** ou **Somente contorno**.

A largura física informada é a largura da imagem original, incluindo o fundo. A altura mantém a proporção. Se o contorno ultrapassar a imagem, a página é ampliada para incluí-lo; a escala física da imagem não muda. O PDF também inclui uma pequena margem da espessura da linha. O SVG amplia seu viewBox e preserva a mesma escala, sem cortar a geometria deslocada.

## Como escolher o rastreio

| Imagem | Método recomendado | Ajustes |
| --- | --- | --- |
| PNG com fundo transparente | Transparência | Opacidade mínima ignora pixels quase transparentes. |
| Ilustração em fundo branco ou de uma cor | Diferença da cor de fundo | Fundo estimado pelos cantos; o conta-gotas permite escolher outro ponto. Tolerância maior ignora mais variações do fundo. |
| Silhueta escura, desenho ou texto em fundo claro | Luminosidade | Limite maior inclui pixels mais claros. Inverter seleção permite rastrear áreas claras. |
| Foto com fundo irregular | Cor de fundo ou luminosidade + correções | Delimite a área e use os pincéis para incluir/excluir regiões. |

Não depende de o objeto estar centralizado. O rastreio percorre toda a imagem ou a área selecionada. Por padrão, retorna apenas contornos externos; **Incluir contornos internos** também traça furos e detalhes da seleção. **Manter só a maior forma** é opcional e remove as outras formas separadas.

## Deslocamento e silhueta geral

- **Deslocamento de 0 mm:** segue os limites detectados, respeitando os ajustes de simplificação e suavização.
- **Positivo (até 50 mm):** expande os polígonos, arredonda suas junções e une áreas sobrepostas. Duas formas podem se unir quando a soma de suas expansões alcança o espaço entre elas. Formas mais afastadas precisam de um deslocamento maior.
- **Negativo (até −20 mm):** contrai as formas. Formas muito pequenas podem desaparecer; a prévia e a contagem deixam isso visível.
- **Contorno geral do conjunto:** constrói uma envoltória convexa das formas selecionadas, antes do deslocamento. Preenche as reentrâncias e produz uma única silhueta; não ajusta automaticamente um círculo perfeito. Não mantém furos internos.

Para formas distribuídas ao longo de um círculo, clique em **Exemplo circular**: com largura de imagem de 150 mm, aparecem 16 formas individuais em 0 mm. Aumente o deslocamento (12 mm une as formas nesse exemplo), ou marque **Contorno geral do conjunto** para envolver todas as formas sem precisar de uma expansão tão grande. Desmarque **Manter só a maior forma** para incluir o conjunto inteiro.

A medida em milímetros usa a largura física da imagem. Por exemplo: uma imagem de trabalho de 600 px com largura física de 150 mm usa 4 px/mm; um deslocamento de 3 mm corresponde a 12 px. Alterar a largura física recalcula a geometria para manter o valor em milímetros. A linha cinza tracejada mostra o limite original quando há deslocamento. A aba Seleção mostra os pixels de origem; Imagem + contorno e Vetor mostram o contorno final.

Simplificação e suavização podem modificar levemente a distância local. Use simplificação mínima e suavização 0% quando a fidelidade do deslocamento for mais importante que o arredondamento visual.

**Salvar app offline** baixa o documento completo com todas as bibliotecas incorporadas. A imagem importada, seu nome e suas correções não entram nessa cópia; o arquivo inicia com o exemplo padrão.

## Limites desta versão

- Não usa IA: cores parecidas entre objeto e fundo, sombras e texturas exigem correções. A estimativa automática de fundo pode falhar quando os objetos cobrem vários cantos; use o conta-gotas.
- O rastreio usa no máximo 1.400 px no maior lado, enquanto a imagem original é preservada para exportação. Os controles em pixels se referem a essa resolução de trabalho.
- PDF é importado por página e rasterizado para rastreio. SVG também é rasterizado: o aplicativo cria um novo contorno, sem editar os caminhos originais.
- PDFs com senha precisam de uma cópia sem proteção. Fontes PDF não incorporadas usam as fontes locais e podem ter diferenças de aparência.
- SVG não carrega recursos externos e remove scripts. Dependências externas podem deixar elementos ausentes; incorpore imagens e converta fontes em caminhos antes da importação quando necessário.
- Simplificação e suavização alteram a geometria. Confira o vetor antes de exportar, principalmente em cantos muito fechados.
- Limite de importação: 60 MB; imagens até 50 megapixels e 16.000 px por lado. GIF importa o quadro exibido pelo navegador, sem animação.
- Não há salvamento de projeto ou persistência de ajustes. Exportar PDF/SVG salva o resultado; recarregar a página limpa a edição.

## Desenvolvimento

Requer Node.js 20 ou superior (validado com Node 24), npm e Python 3 para o servidor opcional.

```sh
npm ci --cache /tmp/contorno-npm
npm run build
npm run dev
```

Para gerar novamente o pacote de download: `npm run package` (requer Python 3). O ZIP deve ser atualizado depois de alterar o aplicativo ou a documentação.

`npm run build` gera novamente `index.html` a partir de `src/`. O arquivo gerado deve ser distribuído junto da versão atual dos fontes. `npm run dev` serve a pasta na porta 4173, sem compilar automaticamente. Para uso offline, basta o HTML pronto.

```sh
npm test
```

Os testes usam Chromium em `/usr/bin/chromium`; defina `CONTORNO_BROWSER` com o caminho do executável se necessário. Os testes carregam o HTML completo com a rede desativada, verificam PNG/SVG/PDF, seleção, ferramentas manuais, exportação e layout móvel. O Chromium gerenciado do ambiente bloqueia navegação `file://`; por isso o teste injeta o documento exato com `setContent`, sem servidor ou recursos de rede. A abertura por duplo clique em um computador pessoal não foi validada neste ambiente gerenciado.

A exportação é verificada pelos operadores de desenho vetorial no PDF e pelos caminhos no SVG, incluindo as versões com e sem imagem. O núcleo também é testado para furos, formas nos limites, pixels diagonais, filtros e simplificação.

## Bibliotecas

PDF.js (Apache-2.0) para leitura e rasterização de PDF; jsPDF (MIT) para exportação; Clipper (Boost Software License 1.0) para deslocamento e união dos polígonos. Os avisos e licenças estão em `THIRD_PARTY_NOTICES.txt`, distribuído com o aplicativo.
