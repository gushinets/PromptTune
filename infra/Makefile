DEV_COMPOSE = docker compose -f docker-compose.base.yml -f docker-compose.dev.yml
PROD_COMPOSE = docker compose -f docker-compose.base.yml -f docker-compose.prod.yml

.PHONY: \
	dev dev-d logs migrate \
	dev-up dev-up-d dev-logs dev-ps dev-config dev-migrate dev-down \
	prod-db-up prod-up prod-migrate prod-logs prod-ps prod-config prod-down

dev: dev-up

dev-d: dev-up-d

logs: dev-logs

migrate: dev-migrate

dev-up:
	$(DEV_COMPOSE) up --build

dev-up-d:
	$(DEV_COMPOSE) up --build -d

dev-logs:
	$(DEV_COMPOSE) logs -f

dev-ps:
	$(DEV_COMPOSE) ps

dev-config:
	$(DEV_COMPOSE) config

dev-migrate:
	$(DEV_COMPOSE) run --rm api alembic upgrade head

dev-down:
	$(DEV_COMPOSE) down

prod-db-up:
	$(PROD_COMPOSE) up -d postgres redis

prod-up:
	$(PROD_COMPOSE) up --build -d api caddy

prod-migrate:
	$(PROD_COMPOSE) run --rm api alembic upgrade head

prod-logs:
	$(PROD_COMPOSE) logs -f

prod-ps:
	$(PROD_COMPOSE) ps

prod-config:
	$(PROD_COMPOSE) config

prod-down:
	$(PROD_COMPOSE) down
