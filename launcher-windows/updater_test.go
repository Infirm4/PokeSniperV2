package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

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
	old, err := findUpdate(packageZip(t, []string{"1.5.4.99"}, nil))
	if err != nil {
		t.Fatal(err)
	}
	parent := t.TempDir()
	folder := filepath.Join(parent, "Minha Extensão")
	if err := old.install(folder); err != nil {
		t.Fatal(err)
	}
	newest, err := findUpdate(packageZip(t, []string{"1.5.4.100", "1.5.4.99"}, nil))
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
			if _, err := findUpdate(data); err == nil {
				t.Fatal("unsafe entry was accepted")
			}
		})
	}
}
