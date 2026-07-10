# registry-ui

`registry-ui` est un navigateur Docker Registry volontairement minimal, avec une structure proche de S3 Browser : un serveur Go, un front statique embarqué, pas de Node, pas de Nginx, pas de `dist` généré et pas d'exemples parasites.

## Ce qui reste

- Un binaire Go autonome.
- Un frontend statique dans `src/public`.
- Un proxy same-origin `/v2` vers Docker Registry.
- Les endpoints `/health`, `/healthz` et `/ready`.
- La commande `registry-ui health`, utilisable dans une image `scratch`.
- Une release GitHub simple via GoReleaser.

## Structure

```text
registry-ui/
├── README.md
├── LICENSE
├── .gitignore
├── .github/
│   └── workflows/
│       └── release.yaml
└── src/
    ├── .dockerignore
    ├── .goreleaser.yaml
    ├── Dockerfile
    ├── go.mod
    ├── main.go
    └── public/
        ├── index.html
        └── assets/
            ├── css/
            │   ├── style.css
            │   └── ui.css
            └── js/
                ├── api.js
                └── app.js
```

## Configuration

| Variable | Défaut | Description |
| --- | --- | --- |
| `PORT` | `8080` | Port HTTP. |
| `LISTEN_ADDR` | `:$PORT` | Adresse d'écoute complète. |
| `REGISTRY_PROXY_PASS_URL` | `http://registry:5000` | Registry upstream utilisé par le proxy `/v2`. |
| `REGISTRY_URL` | alias | Alias compatible pour `REGISTRY_PROXY_PASS_URL`. |
| `NGINX_PROXY_PASS_URL` | alias | Alias compatible pour `REGISTRY_PROXY_PASS_URL`. |
| `PULL_URL` | host du registry | Host affiché dans les commandes `docker pull`. |
| `REGISTRY_UI_TITLE` | `Registry UI` | Titre principal du front. |
| `REGISTRY_TITLE` | `Docker Registry` | Libellé du registre. |
| `CATALOG_PAGE_SIZE` | `100` | Taille de page pour `_catalog`. |
| `TAGS_PAGE_SIZE` | `100` | Taille de page pour les tags. |
| `REGISTRY_USERNAME` / `REGISTRY_PASSWORD` | vide | Basic auth upstream optionnelle. |
| `REGISTRY_BASIC_AUTH` | vide | Header auth préconstruit, par exemple `Basic xxxxx`. |
| `REGISTRY_TOKEN` | vide | Bearer token upstream optionnel. |
| `DELETE_IMAGES` | `false` | Affiche l'action de suppression si le registry la supporte. |
| `HEALTH_URL` | local `/healthz` | URL utilisée par `registry-ui health`. |
| `HEALTH_TIMEOUT` | `2s` | Timeout de la commande health. |

## Lancer localement

```bash
cd src
go run .
```

Avec un registry local :

```bash
cd src
REGISTRY_PROXY_PASS_URL=http://localhost:5000 \
PULL_URL=localhost:5000 \
go run .
```

Ouvre ensuite `http://localhost:8080`.

## Image scratch

```bash
cd src
docker build --build-arg VERSION=v0.1.0 -t registry-ui:v0.1.0 .

docker run --rm -p 8080:8080 \
  -e REGISTRY_PROXY_PASS_URL=http://registry:5000 \
  -e PULL_URL=localhost:5000 \
  registry-ui:v0.1.0
```

L'image finale utilise `FROM scratch`. Le healthcheck Docker appelle le binaire lui-même :

```dockerfile
HEALTHCHECK CMD ["/registry-ui", "health", "--quiet"]
```

## Health

```bash
registry-ui health
registry-ui health --quiet
registry-ui health --url http://127.0.0.1:8080/healthz --timeout 3s
```

Endpoints :

```text
/health
/healthz
/ready
```

## Release v0.1.0

Après le premier push sur GitHub :

```bash
git tag -a v0.1.0 -m "registry-ui v0.1.0"
git push origin v0.1.0
```

Le workflow `.github/workflows/release.yaml` lance GoReleaser et publie les archives Linux `amd64` et `arm64`.

## Licence

AGPL-3.0.
