package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

const chromeFolder = "PokeSniper V2_Chrome"
const braveFolder = "PokeSniper V2_Brave"

func packageZip(t *testing.T, versions []string, extras map[string]string) []byte {
	t.Helper()
	var data bytes.Buffer
	archive := zip.NewWriter(&data)
	write := func(name, content string) {
		t.Helper()
		file, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	for _, version := range versions {
		prefix := "PokeSniperV2-main/PokeSniper V" + version + "/"
		write(prefix+"manifest.json", fmt.Sprintf(`{"name":%q,"version":%q,"manifest_version":3}`, extensionName, version))
		for _, name := range []string{"market-main.js", "background.js", "opportunities.html", "icons/icon-16.png"} {
			write(prefix+name, version)
		}
	}
	for name, content := range extras {
		write(name, content)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestInstallsNewestVersionInTheSameFolder(t *testing.T) {
	old, err := findUpdate(packageZip(t, []string{"1.5.4.99"}, nil), chromeFolder)
	if err != nil {
		t.Fatal(err)
	}
	parent := t.TempDir()
	folder := filepath.Join(parent, "Minha Extensão")
	if err := old.install(folder); err != nil {
		t.Fatal(err)
	}
	newest, err := findUpdate(packageZip(t, []string{"1.5.4.100", "1.5.4.99"}, nil), chromeFolder)
	if err != nil {
		t.Fatal(err)
	}
	if !newest.version.newerThan(old.version) {
		t.Fatal("the newest release was not selected")
	}
	if err := newest.install(folder); err != nil {
		t.Fatal(err)
	}
	installed, err := installedVersion(folder)
	if err != nil || installed != newest.version {
		t.Fatalf("installed %v, %v", installed, err)
	}
	backups, err := filepath.Glob(filepath.Join(parent, ".pokesniper-backup-*", "extensao"))
	if err != nil || len(backups) != 1 {
		t.Fatalf("backups: %v, %v", backups, err)
	}
	previous, err := installedVersion(backups[0])
	if err != nil || previous != old.version {
		t.Fatalf("previous %v, %v", previous, err)
	}
	asset, err := os.ReadFile(filepath.Join(folder, "icons", "icon-16.png"))
	if err != nil || string(asset) != newest.version.String() {
		t.Fatalf("asset %s, %v", asset, err)
	}
}

func TestRejectsUnsafePackagePaths(t *testing.T) {
	const prefix = "PokeSniperV2-main/PokeSniper V1.5.4.100/"
	for _, name := range []string{"../sair.js", `icons\arquivo.js`, "NUL.txt", "BACKGROUND.JS", "x:outro"} {
		t.Run(name, func(t *testing.T) {
			data := packageZip(t, []string{"1.5.4.100"}, map[string]string{prefix + name: "bad"})
			if _, err := findUpdate(data, chromeFolder); err == nil {
				t.Fatal("unsafe entry was accepted")
			}
		})
	}
}

func TestRestoresMissingExtensionFromCurrentLayout(t *testing.T) {
	const base = "PokeSniperV2-main/PokeSniper V2/"
	data := packageZip(t, []string{"1.5.4.86"}, map[string]string{
		base + "extensao/manifest.json":                                   `{"name":"PokeIdle Market Sniper","version":"1.5.4.87","manifest_version":3}`,
		base + "extensao/background.js":                                   "worker",
		base + "extensao/market-main.js":                                  "monitor",
		base + "extensao/opportunities.html":                              "painel",
		base + "PokeSniper.exe":                                           "launcher",
		base + "launcher-windows/main_windows.go":                         "código do launcher",
		"PokeSniperV2-main/pokeidle_bot_io/extensao_chrome/manifest.json": "outro projeto",
	})
	release, err := findUpdate(data, chromeFolder)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(t.TempDir(), "PokeSniper v2", "pokeidle-sniper")
	if !canRestoreExtension(dir) {
		t.Fatal("missing folder must be eligible for recovery")
	}
	if err := release.install(dir); err != nil {
		t.Fatal(err)
	}
	got, err := installedVersion(dir)
	if err != nil || got.String() != "1.5.4.87" {
		t.Fatalf("restored %s, %v", got, err)
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 4 {
		t.Fatalf("only extension files should be installed: %v, %v", files, err)
	}
}

func TestBrowserBuildsUseTheirOwnPackagesAndConfig(t *testing.T) {
	extras := map[string]string{}
	for edition, want := range map[string]string{"chrome": "1.5.4.88", "brave": "1.5.4.89"} {
		b, err := browserFor(edition)
		if err != nil {
			t.Fatal(err)
		}
		base := "PokeSniperV2-main/" + b.releaseFolder() + "/extensao/"
		extras[base+"manifest.json"] = fmt.Sprintf(`{"name":%q,"version":%q,"manifest_version":3}`, extensionName, want)
		for _, name := range []string{"market-main.js", "background.js", "opportunities.html"} {
			extras[base+name] = want
		}
	}
	data := packageZip(t, nil, extras)
	for _, tc := range []struct{ edition, folder, want, configDir, shortcut string }{
		{"chrome", chromeFolder, "1.5.4.88", "PokeSniper", "PokeSniper"},
		{"brave", braveFolder, "1.5.4.89", "PokeSniperBrave", "PokeSniper Brave"},
	} {
		t.Run(tc.edition, func(t *testing.T) {
			b, err := browserFor(tc.edition)
			if err != nil {
				t.Fatal(err)
			}
			if b.configDir != tc.configDir || b.shortcut != tc.shortcut || b.program != tc.edition+".exe" ||
				b.extensionsPage != tc.edition+"://extensions/" || b.releaseFolder() != tc.folder {
				t.Fatalf("browser configuration: %+v", b)
			}
			release, err := findUpdate(data, b.releaseFolder())
			if err != nil || release.version.String() != tc.want {
				t.Fatalf("release %v, %v", release, err)
			}
		})
	}
}

func TestRecoveryDoesNotOfferToReplaceNonEmptyUnknownFolder(t *testing.T) {
	dir := t.TempDir()
	if !canRestoreExtension(dir) {
		t.Fatal("empty folder must be eligible for recovery")
	}
	if err := os.WriteFile(filepath.Join(dir, "documento.txt"), []byte("arquivo local"), 0644); err != nil {
		t.Fatal(err)
	}
	if canRestoreExtension(dir) {
		t.Fatal("folder containing existing files must not be replaced during recovery")
	}
}
