# 0007 — Gerar .xlsx sem biblioteca externa

**Situação**: aceita

## Problema

A exportação era CSV. No LibreOffice, CSV abre com caixa de diálogo pedindo
separador e codificação, e chega sem cor, sem largura de coluna e sem os
painéis congelados — justamente o que faz a escala ser legível.

## Opções

1. **SheetJS por CDN.** Resolve, mas falha sem internet — e a versão offline
   existe para esse cenário.
2. **Empacotar a biblioteca no arquivo.** Acrescenta centenas de kilobytes.
3. **Gerar o OOXML à mão.** Um `.xlsx` é um ZIP com alguns arquivos XML.
4. **Formato `.fods`.** XML único, aberto pelo LibreOffice sem esforço — mas o
   Excel não abre.

## Decisão

Opção 3. Cerca de 200 linhas: tabela CRC32, escritor de ZIP sem compressão e
montagem do XML de planilha, estilos e relacionamentos.

## Verificação

Não ficou no "deve funcionar". O LibreOffice está instalado no ambiente de
desenvolvimento, então o arquivo gerado foi **aberto de verdade** e convertido
para PDF, e o resultado inspecionado visualmente.

Conferido: CRC de todas as seis partes do pacote, acentuação, painéis
congelados em D5, orientação paisagem e ajuste à largura da folha.

## O que se perdeu

Não há fórmulas, gráficos nem múltiplas abas — o gerador cobre o que a escala
precisa. Se um dia for preciso mais, o caminho é a opção 1 na versão web, que
tem internet garantida, mantendo este gerador na versão offline.
