"""Confere limites dos pacotes sem ler configuração ou dados reais."""
import hashlib
import importlib.util
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'empacotar_hostgator', Path(__file__).resolve().parents[1] / 'build/empacotar-hostgator.py')
modulo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(modulo)


class Empacotamento(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.raiz = Path(self.temp.name) / 'projeto'
        self.saida = Path(self.temp.name) / 'pacotes'
        for nome, dados in {
            'dist/escala-hostgator.html': '<html>fixture</html>',
            'api/auth.php': '<?php /* auth */', 'api/comum.php': '<?php /* comum */',
            'api/dados.php': '<?php /* dados */', 'api/minha.php': '<?php /* minha */',
            'api/.htaccess': 'Options -Indexes',
            'infra/htaccess-raiz.exemplo': '# modelo\nRewriteEngine On\n',
            'banco/verificar-e-migrar.sql': '-- migracao ficticia',
            'banco/conferir-atualizacao.sql': 'SELECT 1;',
            'api/config.php': 'PRIVATE_SECRET_NEVER_INCLUDE',
            'api/config.exemplo.php': 'EXAMPLE_MUST_NOT_DEPLOY',
            'api/error_log': 'PRIVATE_LOG_NEVER_INCLUDE',
            'api/diagnostico.php': 'PRIVATE_DIAGNOSTIC_NEVER_INCLUDE',
            'backup.sql': 'PRIVATE_CUSTOMER_DATA_NEVER_INCLUDE',
        }.items():
            p = self.raiz / nome
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(dados, encoding='utf-8')

    def test_publicacao_exclui_segredos_e_arquivos_operacionais(self):
        manifest = modulo.empacotar(self.raiz, self.saida)
        esperado = {'index.html', 'api/auth.php', 'api/comum.php', 'api/dados.php',
                    'api/minha.php', 'api/.htaccess'}
        with zipfile.ZipFile(self.saida / 'publicacao-hostgator.zip') as z:
            self.assertEqual(set(z.namelist()), esperado | {'api/'})
            for nome in z.namelist():
                if z.getinfo(nome).is_dir():
                    continue
                conteudo = z.read(nome)
                fonte = self.raiz / ('dist/escala-hostgator.html' if nome == 'index.html' else nome)
                self.assertEqual(conteudo, fonte.read_bytes())
                self.assertNotIn(b'PRIVATE_', conteudo)
                self.assertNotIn(b'EXAMPLE_MUST_NOT_DEPLOY', conteudo)
                self.assertEqual(hashlib.sha256(conteudo).hexdigest(),
                                 manifest['pacotes']['publicacao-hostgator.zip']['arquivos'][nome])

    def test_manutencao_explicita_e_separada(self):
        modulo.empacotar(self.raiz, self.saida)
        with zipfile.ZipFile(self.saida / 'preparar-manutencao.zip') as z:
            self.assertEqual(z.namelist(), ['.htaccess'])
        with zipfile.ZipFile(self.saida / 'ativar-manutencao.zip') as z:
            self.assertEqual(set(z.namelist()), {'.htaccess', '.shiftflow-manutencao'})
            self.assertEqual(z.read('.shiftflow-manutencao'), b'')

    def test_permissoes_servidor_e_timestamps(self):
        modulo.empacotar(self.raiz, self.saida)
        for caminho in self.saida.glob('*.zip'):
            with zipfile.ZipFile(caminho) as z:
                self.assertIsNone(z.testzip())
                for item in z.infolist():
                    self.assertEqual(stat.S_IMODE(item.external_attr >> 16), 0o755 if item.is_dir() else 0o644)
                    self.assertGreaterEqual(item.date_time[0], 1980)
                    self.assertEqual(item.extra[:4], b'UT\x05\x00')
                    self.assertNotIn('..', Path(item.filename).parts)

    def test_nao_gera_publicacao_incompleta_sem_build(self):
        (self.raiz / 'dist/escala-hostgator.html').unlink()
        with self.assertRaises(FileNotFoundError):
            modulo.empacotar(self.raiz, self.saida)
        self.assertFalse(self.saida.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
