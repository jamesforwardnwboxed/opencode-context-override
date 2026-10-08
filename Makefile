OPENCODE_CONFIG_DIR ?=

.PHONY: install uninstall check

# Copies the plugin into the OpenCode config dir and disables the built-in Context block in cli.json.
# Re-run after pulling changes. OPENCODE_CONFIG_DIR defaults to ${XDG_CONFIG_HOME:-~/.config}/opencode.
install:
	node install.mjs install $(OPENCODE_CONFIG_DIR)

uninstall:
	node install.mjs uninstall $(OPENCODE_CONFIG_DIR)

check:
	node check.mjs
