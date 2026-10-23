#!/bin/bash
case "$PWD" in
  /Users/surya/Projects/dex-ai*)
    cat << 'JSON'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"MANDATORY (dex-ai project rule, see CLAUDE.md \"Mandatory Skill Routing\"): before executing this request, identify which specialist skill(s) from the routing table apply (engineering-skills/engineering-advanced-skills for code, product-skills/c-level-skills/marketing-skills for product and strategy work, superpowers process skills first when the approach is unclear) and invoke them via the Skill tool before writing code or making a decision. Do not skip this even for a small-looking task. Do not redo research/analysis that already exists in docs/superpowers/specs, docs/superpowers/plans, or the market audit doc — extend or verify instead."}}
JSON
    ;;
  *)
    echo '{}'
    ;;
esac
