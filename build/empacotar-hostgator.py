#!/usr/bin/env python3
"""Gera os pacotes locais. Não acessa hospedagem nem banco de dados."""
import hashlib
import json
import stat
import struct
import subprocess
import time
import zipfile
from pathlib import Path, PurePosixPath


ARQUIVOS_API = ('auth.php', 'comum.php', 'dados.php', 'minha.php', '.htaccess')


def criar_zip(caminho, arquivos, instante):
    """Permissões de servidor e timestamp UTC, sem herdar o umask da IDE."""
    with zipfile.ZipFile(caminho, 'w') as pacote:
        pastas = {str(p) + '/' for nome in arquivos for p in PurePosixPath(nome).parents if str(p) != '.'}
        entradas = [(n, b'', True) for n in sorted(pastas, key=len)]
        entradas.extend((n, d, False) for n, d in arquivos.items())
        for nome, conteudo, pasta in entradas:
            entrada = zipfile.ZipInfo(nome, time.localtime(instante)[:6])
            entrada.create_system = 3
            entrada.external_attr = ((stat.S_IFDIR | 0o755) if pasta else (stat.S_IFREG | 0o644)) << 16
            if pasta:
                entrada.external_attr |= 0x10
            entrada.compress_type = zipfile.ZIP_DEFLATED
            # Extended Timestamp: preserva o instante ao extrair em outro fuso.
            entrada.extra = struct.pack('<HHBI', 0x5455, 5, 1, instante)
            pacote.writestr(entrada, conteudo)


def revisao_git(raiz):
    def ler(*argumentos):
        return subprocess.check_output(
            ['git', '-C', str(raiz), *argumentos],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
    try:
        return {'head': ler('rev-parse', 'HEAD'),
                'arvore_limpa': not bool(ler('status', '--porcelain', '--untracked-files=all'))}
    except (OSError, subprocess.CalledProcessError):
        return {'head': None, 'arvore_limpa': None}


def empacotar(raiz, destino):
    raiz, destino = Path(raiz), Path(destino)
    fontes = {'index.html': raiz / 'dist/escala-hostgator.html'}
    fontes.update({f'api/{nome}': raiz / 'api' / nome for nome in ARQUIVOS_API})
    modelo = raiz / 'infra/htaccess-raiz.exemplo'
    scripts = {nome: raiz / 'banco' / nome for nome in
               ('verificar-e-migrar.sql', 'conferir-atualizacao.sql')}
    for caminho in [*fontes.values(), modelo, *scripts.values()]:
        if not caminho.is_file():
            raise FileNotFoundError(f'Arquivo necessário ausente: {caminho}. Rode build/montar.py primeiro.')

    publicacao = {nome: caminho.read_bytes() for nome, caminho in fontes.items()}
    htaccess = modelo.read_bytes()
    pacotes = {
        'publicacao-hostgator.zip': publicacao,
        'preparar-manutencao.zip': {'.htaccess': htaccess},
        'ativar-manutencao.zip': {'.htaccess': htaccess, '.shiftflow-manutencao': b''},
    }
    destino.mkdir(parents=True, exist_ok=True)
    instante = int(time.time())
    manifest = {'git': revisao_git(raiz), 'pacotes': {}, 'sql': {}}
    for nome, arquivos in pacotes.items():
        caminho = destino / nome
        criar_zip(caminho, arquivos, instante)
        manifest['pacotes'][nome] = {
            'sha256': hashlib.sha256(caminho.read_bytes()).hexdigest(),
            'arquivos': {n: hashlib.sha256(d).hexdigest() for n, d in arquivos.items()},
        }
    for nome, caminho in scripts.items():
        dados = caminho.read_bytes()
        (destino / nome).write_bytes(dados)
        manifest['sql'][nome] = hashlib.sha256(dados).hexdigest()
    (destino / 'manifest-publicacao.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    projeto = Path(__file__).resolve().parent.parent
    resultado = empacotar(projeto, projeto / 'dist')
    print(json.dumps({'gerados_em': str(projeto / 'dist'), 'git': resultado['git'],
                      'pacotes': list(resultado['pacotes'])}, ensure_ascii=False))
