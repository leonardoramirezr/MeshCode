PNPM  ?= pnpm
CARGO ?= cargo
TAURI_DIR := src-tauri

.DEFAULT_GOAL := help

.PHONY: help install dev dev-web build build-debug build-web preview check check-rust fmt lint test clean clean-all

help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

node_modules: package.json
	$(PNPM) install
	@touch node_modules

install: ## Instala dependencias de JS
	$(PNPM) install

dev: node_modules ## Ejecuta la app de Tauri en modo desarrollo
	$(PNPM) tauri dev

dev-web: node_modules ## Ejecuta solo el frontend (Vite) en modo desarrollo
	$(PNPM) dev

build: node_modules ## Genera el build de producción de la app (bundle)
	$(PNPM) tauri build

build-debug: node_modules ## Genera un build de la app en modo debug
	$(PNPM) tauri build --debug

build-web: node_modules ## Genera solo el build del frontend
	$(PNPM) build

preview: build-web ## Previsualiza el build del frontend
	$(PNPM) preview

check: node_modules check-rust ## Verifica tipos (Svelte/TS) y compila Rust
	$(PNPM) check

check-rust: ## Verifica que el código Rust compile
	cd $(TAURI_DIR) && $(CARGO) check

fmt: ## Formatea el código Rust
	cd $(TAURI_DIR) && $(CARGO) fmt

lint: ## Ejecuta clippy sobre el código Rust
	cd $(TAURI_DIR) && $(CARGO) clippy -- -D warnings

test: ## Ejecuta los tests de Rust
	cd $(TAURI_DIR) && $(CARGO) test

clean: ## Elimina artefactos de build
	rm -rf build .svelte-kit
	cd $(TAURI_DIR) && $(CARGO) clean

clean-all: clean ## Elimina artefactos de build y node_modules
	rm -rf node_modules
