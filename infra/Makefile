.PHONY: dev prod down logs

dev:
	docker compose -f docker-compose.base.yml -f docker-compose.dev.yml up --build

dev-d:
	docker compose -f docker-compose.base.yml -f docker-compose.dev.yml up --build -d

prod:
	docker compose -f docker-compose.base.yml -f docker-compose.prod.yml up --build -d

down:
	docker compose -f docker-compose.base.yml -f docker-compose.dev.yml -f docker-compose.prod.yml down

logs:
	docker compose -f docker-compose.base.yml -f docker-compose.dev.yml logs -f

migrate:
	docker compose -f docker-compose.base.yml -f docker-compose.dev.yml exec api alembic upgrade head
