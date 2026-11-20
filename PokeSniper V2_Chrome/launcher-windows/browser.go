package main

import "fmt"

// The Windows build selects the edition using -X main.browserEdition=brave.
var browserEdition = "chrome"

type browser struct {
	name, program, installation, extensionsPage, configDir, shortcut string
}

func browserFor(edition string) (browser, error) {
	switch edition {
	case "chrome":
		return browser{
			name: "Chrome", program: "chrome.exe", installation: "Google/Chrome/Application",
			extensionsPage: "chrome://extensions/", configDir: "PokeSniper", shortcut: "PokeSniper",
		}, nil
	case "brave":
		return browser{
			name: "Brave", program: "brave.exe", installation: "BraveSoftware/Brave-Browser/Application",
			extensionsPage: "brave://extensions/", configDir: "PokeSniperBrave", shortcut: "PokeSniper Brave",
		}, nil
	default:
		return browser{}, fmt.Errorf("edição do PokeSniper desconhecida: %q", edition)
	}
}

func (b browser) releaseFolder() string {
	return "PokeSniper V2_" + b.name
}
