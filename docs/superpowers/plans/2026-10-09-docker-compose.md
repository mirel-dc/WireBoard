# Wireboard Docker Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полный запуск, сборка и CLI через Docker Compose и just на Windows/macOS/Linux.

**Architecture:** Single service, embedded frontend, named volume; loopback host publication with explicit browser origin, internal authenticated CLI; host browser opener.

**Tech Stack:** Rust/axum/clap, Docker multi-stage Node/Rust/Debian, Compose, just, PowerShell/sh helpers.

**Spec:** ../specs/2026-10-09-docker-compose-design.md

## Global Constraints

- Default native listener remains 127.0.0.1; only explicit container flag permits 0.0.0.0. Browser origin stays HTTP loopback; no auth bypass.
- No global Codex changes, Git initialization, push, automatic native data migration or volume deletion.
- Host runtime requires Docker/Compose, just, standard shell/opener; no Node/Rust needed on host.
- Named volume /data, non-root user, private runtime permissions; SIGTERM drains SSE, grace 15 seconds.

## Task 1: Container network and CLI contract

- [x] Write real-process CLI test for --listen / --public-origin and open --print-url, distinct public/internal ports, cookie exchange and invalid Host/Origin.
- [x] Run test RED (new flags absent).
- [x] Implement network options, loopback public origin validation, exact internal/external Host, private grant output and SIGTERM handler.
- [x] Run tests, fmt and clippy GREEN.

## Task 2: Container build, recipes and host helpers

- [x] Add Dockerfile/.dockerignore/compose.yaml/.env.example and justfile, using current CLI contract.
- [x] Implement host browser helpers and argv-preserving cli/upload/download.
- [x] Validate Compose and just parsing, real build and up --wait.

## Task 3: Delivery verification and review

- [x] Real container CLI, browser, export, restart persistence, graceful stop and permissions smoke.
- [x] Independent Rust/security and scripts/Compose review; fix important findings and recheck affected flows.
- [x] Document primary Docker launch, data boundary, CLI paths and portability; retain evidence under work/docker.

## Review Focus

External/internal port divergence; hostile origins; printed capabilities; signal shutdown with SSE; data survival without down -v; argv and paths containing spaces; root filesystem/volume ownership; build context containing runtime secrets; different OS shells.
