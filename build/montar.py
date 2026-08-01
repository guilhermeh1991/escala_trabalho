#!/usr/bin/env python3
"""
Monta os dois aplicativos a partir das fontes.

    python3 build/montar.py

Gera em dist/:
    escala-offline.html   um arquivo só, sem internet, dados no dispositivo
    escala-web.html       multiusuário, com Supabase

O template da interface é o mesmo nos dois. O que muda é a camada de
acesso e de dados, trocada aqui na montagem.
"""
import pathlib, sys, re

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SRC  = RAIZ / 'src'
DIST = RAIZ / 'dist'
DIST.mkdir(exist_ok=True)

def ler(caminho):
    p = RAIZ / caminho
    if not p.exists():
        sys.exit(f'arquivo ausente: {caminho}')
    return p.read_text(encoding='utf-8')

def exigir(texto, marcador, rotulo):
    if marcador not in texto:
        sys.exit(f'marcador ausente ({rotulo}): {marcador[:60]}')

# ---------------------------------------------------------------- fontes
template = ler('src/app/template.html')
motor    = ler('src/motor/motor.js').replace(
    "if(typeof module !== 'undefined') module.exports",
    "if(typeof module !== 'undefined' && typeof module.exports !== 'undefined') module.exports")
planilha = ler('src/motor/planilha.js').replace(
    "if (typeof module !== 'undefined') module.exports = { gerarXLSX, zipar, crc32 };", "")
acesso_dados = ler('src/app/acesso-dados.js')
acesso_telas = ler('src/app/acesso-telas.js')
telas_html   = ler('src/app/telas-acesso.html')
aba_acessos  = ler('src/app/aba-acessos.html')

exigir(template, '/*ENGINE*/', 'ponto de injeção do motor')

# ================================================================
#  VERSÃO OFFLINE — o template já é a versão offline
# ================================================================
offline = template.replace('/*CSS_MINHA*/', '', 1)
offline = offline.replace('<button data-view="minha" style="display:none">Minha escala</button>', '', 1)
offline = offline.replace('/*ENGINE*/', motor + "\n\n" + planilha, 1)
(DIST / 'escala-offline.html').write_text(offline, encoding='utf-8')

# ================================================================
#  VERSÃO WEB
# ================================================================
web = template.replace('/*CSS_MINHA*/', '', 1)
web = web.replace('<button data-view="minha" style="display:none">Minha escala</button>', '', 1)

# 1. biblioteca do Supabase no <head>
exigir(web, '<title>Quadro de Escala — Bauru</title>', 'title')
web = web.replace('<title>Quadro de Escala — Bauru</title>',
"""<title>Quadro de Escala</title>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>""", 1)

# 2. telas de acesso no lugar do login local
ini = web.index('<section id="login">')
fim = web.index('</section>', ini) + len('</section>')
web = web[:ini] + telas_html.strip() + web[fim:]

# 3. aba Usuários -> Acessos
web = web.replace('<button data-view="usuarios">Usuários</button>',
                  '<button data-view="usuarios">Acessos</button>', 1)
ini = web.index('<section class="view" data-view="usuarios">')
fim = web.index('</section>', web.index('</table>', ini)) + len('</section>')
web = web[:ini] + aba_acessos.strip() + web[fim:]

# 4. indicador de sincronização no cabeçalho
exigir(web, '<span id="quem"></span>', 'marcador quem')
web = web.replace('<span id="quem"></span>',
                  '<span id="sync-estado" style="font-size:12px"></span><span id="quem"></span>', 1)

# 5. camada de dados: Supabase no lugar do armazenamento local
ini = web.index('/* ============================================================\n   ARMAZENAMENTO')
fim = web.index('/* ============================================================\n   DADOS INICIAIS')
CONFIG = """/* ============================================================
   CONFIGURAÇÃO — preencha com os dados do seu projeto Supabase
   (Project Settings > API). A chave anon é pública por desenho:
   quem protege os dados é a política RLS no banco, não ela.
   ============================================================ */
const CONFIG = {
  SUPABASE_URL:      'COLE_AQUI_A_URL_DO_PROJETO',
  SUPABASE_ANON_KEY: 'COLE_AQUI_A_CHAVE_ANON'
};

"""
web = web[:ini] + CONFIG + acesso_dados + "\n\n" + web[fim:]

# 6. fluxo de acesso no lugar do login local
ini = web.index('/* ============================================================\n   ESTADO')
fim = web.index('/* ---------- navegação ---------- */')
web = web[:ini] + acesso_telas + "\n\n" + web[fim:]

# 7. remover a gestão local de usuários
ini = web.index('/* ---------- usuários ---------- */')
fim = web.index('/* ============================================================\n   GERAR / PINTAR GRADE')
web = web[:ini] + web[fim:]

# 8. ajustes finos
web = web.replace("pintarParams(); pintarEquipe(); pintarAus(); pintarUsers(); carregarPeriodoSalvo();",
                  "pintarParams(); pintarEquipe(); pintarAus(); carregarPeriodoSalvo();", 1)
web = web.replace(
  "const mk = (l)=>l.map((r,i)=>({id:r[0].toLowerCase().replace(/[^a-z]/g,'')+i, nome:r[0], cargo:r[1], horario:r[2],",
  "const mk = (l)=>l.map((r,i)=>({nome:r[0], cargo:r[1], horario:r[2],", 1)

web = web.replace('/*ENGINE*/', motor + "\n\n" + planilha, 1)
(DIST / 'escala-web.html').write_text(web, encoding='utf-8')

# ================================================================
#  VERSÃO HOSTGATOR (PHP + MySQL)
# ================================================================
php_dados = ler('src/app/acesso-dados-php.js')
php_telas = ler('src/app/acesso-telas-php.js')
php_minha = ler('src/app/minha-escala.js')
css_minha = ler('src/app/minha-escala.css')

hg = template.replace('/*CSS_MINHA*/', css_minha, 1)
hg = hg.replace('<button data-view="minha" style="display:none">Minha escala</button>',
                '<button data-view="minha" style="display:none">Minha escala</button>', 1)
hg = hg.replace('<title>Quadro de Escala — Bauru</title>',
                '<title>Quadro de Escala</title>', 1)

ini = hg.index('<section id="login">')
fim = hg.index('</section>', ini) + len('</section>')
hg = hg[:ini] + telas_html.strip() + hg[fim:]

hg = hg.replace('<button data-view="usuarios">Usuários</button>',
                '<button data-view="usuarios">Acessos</button>', 1)
ini = hg.index('<section class="view" data-view="usuarios">')
fim = hg.index('</section>', hg.index('</table>', ini)) + len('</section>')
hg = hg[:ini] + aba_acessos.strip() + hg[fim:]

hg = hg.replace('<span id="quem"></span>',
                '<span id="sync-estado" style="font-size:12px"></span><span id="quem"></span>', 1)

ini = hg.index('/* ============================================================\n   ARMAZENAMENTO')
fim = hg.index('/* ============================================================\n   DADOS INICIAIS')
CONFIG_HG = """/* ============================================================
   CONFIGURAÇÃO
   Se a pasta api/ estiver ao lado deste arquivo, não precisa mexer.
   ============================================================ */
const CONFIG = { API: 'api' };

"""
hg = hg[:ini] + CONFIG_HG + php_dados + "\n\n" + hg[fim:]

ini = hg.index('/* ============================================================\n   ESTADO')
fim = hg.index('/* ---------- navegação ---------- */')
hg = hg[:ini] + php_telas + "\n\n" + hg[fim:]

ini = hg.index('/* ---------- usuários ---------- */')
fim = hg.index('/* ============================================================\n   GERAR / PINTAR GRADE')
hg = hg[:ini] + hg[fim:]

hg = hg.replace("pintarParams(); pintarEquipe(); pintarAus(); pintarUsers(); carregarPeriodoSalvo();",
                "pintarParams(); pintarEquipe(); pintarAus(); carregarPeriodoSalvo();", 1)
hg = hg.replace(
  "const mk = (l)=>l.map((r,i)=>({id:r[0].toLowerCase().replace(/[^a-z]/g,'')+i, nome:r[0], cargo:r[1], horario:r[2],",
  "const mk = (l)=>l.map((r,i)=>({nome:r[0], cargo:r[1], horario:r[2],", 1)
hg = hg.replace('/*ENGINE*/', motor + "\n\n" + planilha + "\n\n" + php_minha, 1)
exigir(hg, 'pintarAcessos();', 'gancho de papel')
hg = hg.replace('  pintarAcessos();', '  pintarAcessos();\n  aplicarPapel();', 1)
(DIST / 'escala-hostgator.html').write_text(hg, encoding='utf-8')

# ---------------------------------------------------------------- conferência
conferir = {
  'escala-offline.html': {
      'motor embutido':      'function gerarEscala' in offline,
      'planilha embutida':   'function gerarXLSX' in offline,
      'sem código Supabase': ('supabase-js' not in offline and 'createClient' not in offline),
  },
  'escala-web.html': {
      'motor embutido':      'function gerarEscala' in web,
      'planilha embutida':   'function gerarXLSX' in web,
      'Supabase carregado':  'supabase-js@2' in web,
      'telas de acesso':     'id="tela-cadastro"' in web,
      'sem hash caseiro':    'async function sha256' not in web,
      'sem login local':     'lg-user' not in web,
      'sem service_role':    'service_role' not in web,
      'sem placeholder css': '/*CSS_MINHA*/' not in web,
  },
  'escala-hostgator.html': {
      'motor embutido':      'function gerarEscala' in hg,
      'planilha embutida':   'function gerarXLSX' in hg,
      'telas de acesso':     'id="tela-cadastro"' in hg,
      'aponta para api/':    "const CONFIG = { API: 'api' }" in hg,
      'sem código Supabase': ('supabase-js' not in hg and 'createClient' not in hg),
      'sem hash caseiro':    'async function sha256' not in hg,
      'sem login local':     'lg-user' not in hg,
      'tela minha escala':   'pintarMinhaEscala' in hg,
      'css minha escala':    '.me-grade' in hg,
      'papel aplicado':      'aplicarPapel();' in hg,
      'sem placeholder css': '/*CSS_MINHA*/' not in hg,
  }
}
falhou = False
for arquivo, itens in conferir.items():
    print(f'\n{arquivo}')
    for k, v in itens.items():
        print(('  ok    ' if v else '  FALHA ') + k)
        falhou = falhou or not v

tam = lambda n: round((DIST / n).stat().st_size / 1024)
print(f"\nescala-offline.html   {tam('escala-offline.html')} KB")
print(f"escala-web.html       {tam('escala-web.html')} KB")
print(f"escala-hostgator.html {tam('escala-hostgator.html')} KB")
sys.exit(1 if falhou else 0)
