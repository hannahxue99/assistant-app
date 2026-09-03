# Tap To Edit Details Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove browse-state pencil buttons and let users edit original content or aggregate topics by tapping the content itself.

**Architecture:** Keep the existing correction and topic rename data paths. The original-entry page enters its existing full edit mode from title/body taps and retains “完成” only while editing; the topic page performs inline editing and saves on blur or keyboard submit, then updates route state so list screens reload the new topic on focus.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, TypeScript, expo-sqlite

---

### Task 1: Make original content tappable

**Files:**
- Modify: `app/entry/[id].tsx`

1. Remove the browse-state pencil action.
2. Make both title and body accessible tap targets that enter the existing edit mode.
3. Show “完成” only in edit mode and preserve no-change save behavior.

### Task 2: Auto-save aggregate topic edits

**Files:**
- Modify: `app/topic/[name].tsx`

1. Remove the page-level edit action.
2. Make the topic title enter inline editing.
3. Save on input blur or keyboard submit with duplicate-call protection.
4. Preserve empty-title validation and duplicate-topic merge confirmation.

### Task 3: Synchronize design and verification

**Files:**
- Create: `design/tap-to-edit-details.svg`
- Modify: `DESIGN_SYSTEM.md`
- Modify: `TESTCASES.md`

1. Store a clean UI artifact without explanatory text inside the depicted page.
2. Record interaction and acceptance rules.
3. Run typecheck and existing regression tests, then create a PR.
