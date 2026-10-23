# ADR 0005: Public Naming Deferred to Professional Trademark/Domain Clearance

**Status:** Accepted
**Date:** 2026-08-14

## Context
"Dex" was checked and found to collide with Samsung's registered "DeX" trademark (2016, Desktop eXperience) and ControlUp's actively-marketed "DEX" product line (Digital Employee Experience) in adjacent enterprise software space; dex.com/.ai/.io are all registered. Two alternative candidates ("Sleuth," "Veyra") were spot-checked and both also collided with existing active SaaS companies (sleuth.io deployment tracking; at least five distinct companies using "Veyra"). This demonstrates the real problem: informal web search can rule a name out but can never confirm one is clear — only a professional USPTO/EUIPO trademark search plus registrar check can do that.

## Decision
"Dex" continues as an **internal codename only** for all engineering, documentation, and planning artifacts. It does not get registered as a domain, filed as a trademark, or used in any customer-facing copy, landing page, or app-store listing. A real trademark/domain clearance search (via a trademark attorney or a paid clearance service, not ad-hoc web search) is a required gate before the Week 3 "Shopify App Store listing draft" step in the technical architecture build order, and before any public marketing material is produced.

## Consequences
- Unblocks the rest of the pre-code workflow (this was becoming a naming search loop with diminishing returns).
- Final public name is not yet chosen — this is a known open item, not a hidden one.
- Superseded when: a professional clearance search returns a cleared name, at which point every doc's "Dex" references get a single global rename pass.
