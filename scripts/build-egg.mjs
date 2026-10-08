import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const install = readFileSync(join(root, 'install.sh'), 'utf8').replace(/\r\n/g, '\n')

const egg = {
  _comment: 'Kotl-EV/Poliv — Node 24, SQLite, site + API on SERVER_PORT',
  meta: {
    version: 'PTDL_v2',
    update_url: null,
  },
  exported_at: '2026-10-08T00:00:00+00:00',
  name: 'poliv',
  author: '74097230+Kotl-EV@users.noreply.github.com',
  description:
    'Полив: редактор автополива. Node.js 24, SQLite в data/poliv.db. Сайт и API на основном порту сервера. GIT_REPO — GitHub-репозиторий (как у Jarus). Пустой GIT_REPO — заливка файлов через SFTP.',
  features: null,
  docker_images: {
    'Node.js 24': 'ghcr.io/ptero-eggs/yolks:nodejs_24',
    'Node.js 25': 'ghcr.io/ptero-eggs/yolks:nodejs_25',
  },
  file_denylist: [],
  startup: 'bash /home/container/start.sh',
  config: {
    files: '{}',
    startup: '{\n    "done": "Poliv is listening"\n}',
    logs: '{}',
    stop: '^C',
  },
  scripts: {
    installation: {
      script: install,
      container: 'ghcr.io/pterodactyl/installers:debian',
      entrypoint: 'bash',
    },
  },
  variables: [
    {
      name: 'GitHub repo',
      description: 'Public repo URL with Poliv source. Empty = keep files already on the volume (SFTP).',
      env_variable: 'GIT_REPO',
      default_value: 'https://github.com/Kotl-EV/Poliv',
      user_viewable: true,
      user_editable: true,
      rules: 'nullable|string|max:191',
      field_type: 'text',
    },
    {
      name: 'Git branch',
      description: 'Branch to download (usually main).',
      env_variable: 'GIT_BRANCH',
      default_value: 'main',
      user_viewable: true,
      user_editable: true,
      rules: 'required|string|max:64',
      field_type: 'text',
    },
    {
      name: 'GitHub token',
      description: 'Only for a private repository. Leave empty if the repo is public.',
      env_variable: 'GIT_TOKEN',
      default_value: '',
      user_viewable: false,
      user_editable: true,
      rules: 'string|max:191',
      field_type: 'text',
    },
    {
      name: 'Auto-update on start',
      description: '1 = npm install on every start. 0 = only if node_modules is missing. data/ is never overwritten.',
      env_variable: 'AUTO_UPDATE',
      default_value: '0',
      user_viewable: true,
      user_editable: true,
      rules: 'required|string|in:0,1',
      field_type: 'text',
    },
  ],
}

writeFileSync(join(root, 'egg-poliv.json'), JSON.stringify(egg, null, 4) + '\n', 'utf8')
console.log('wrote egg-poliv.json')
