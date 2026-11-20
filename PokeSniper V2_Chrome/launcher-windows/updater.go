package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const (
	updateURL       = "https://codeload.github.com/Infirm4/PokeSniperV2/zip/refs/heads/main"
	maxArchive      = 24 << 20
	maxExtension    = 32 << 20
	extensionName   = "PokeIdle Market Sniper"
	extensionPrefix = "PokeSniper V"
)

type version [4]int

func parseVersion(raw string) (version, error) {
	var result version
	parts := strings.Split(raw, ".")
	if len(parts) != len(result) {
		return result, errors.New("versão inválida")
	}
	for index, part := range parts {
		number, err := strconv.ParseUint(part, 10, 16)
		if err != nil {
			return version{}, errors.New("versão inválida")
		}
		result[index] = int(number)
	}
	return result, nil
}

func (v version) newerThan(other version) bool {
	for i, part := range v {
		if part != other[i] {
			return part > other[i]
		}
	}
	return false
}

func (v version) String() string {
	return fmt.Sprintf("%d.%d.%d.%d", v[0], v[1], v[2], v[3])
}

type manifest struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	ManifestVersion int    `json:"manifest_version"`
}

func readVersion(reader io.Reader) (version, error) {
	var m manifest
	err := json.NewDecoder(io.LimitReader(reader, 128<<10)).Decode(&m)
	if err != nil || m.Name != extensionName || m.ManifestVersion != 3 {
		return version{}, errors.New("o manifesto não é do PokeSniper")
	}
	return parseVersion(m.Version)
}

func installedVersion(folder string) (version, error) {
	file, err := os.Open(filepath.Join(folder, "manifest.json"))
	if err != nil {
		return version{}, err
	}
	defer file.Close()
	return readVersion(file)
}

func canRestoreExtension(folder string) bool {
	if !filepath.IsAbs(folder) || filepath.Dir(folder) == filepath.Clean(folder) {
		return false
	}
	entries, err := os.ReadDir(folder)
	return errors.Is(err, os.ErrNotExist) || err == nil && len(entries) == 0
}

type update struct {
	version version
	base    string
	files   []*zip.File
}

func findUpdate(data []byte, releaseFolder string) (*update, error) {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	var latest *update
search:
	for _, file := range archive.File {
		parts := strings.Split(file.Name, "/")
		switch {
		case len(parts) == 4 && (parts[1] == releaseFolder || parts[1] == "PokeSniper V2") && parts[2] == "extensao" && parts[3] == "manifest.json":
			candidate, err := zipVersion(file)
			if err != nil {
				return nil, fmt.Errorf("manifesto inválido na pasta %s: %w", parts[1], err)
			}
			if parts[1] == releaseFolder || latest == nil || candidate.newerThan(latest.version) {
				latest = &update{version: candidate, base: strings.TrimSuffix(file.Name, "manifest.json")}
			}
			if parts[1] == releaseFolder {
				break search
			}
		case len(parts) == 3 && strings.HasPrefix(parts[1], extensionPrefix) && parts[2] == "manifest.json":
			candidate, err := parseVersion(strings.TrimPrefix(parts[1], extensionPrefix))
			if err == nil && (latest == nil || candidate.newerThan(latest.version)) {
				latest = &update{version: candidate, base: strings.TrimSuffix(file.Name, "manifest.json")}
			}
		}
	}
	if latest == nil {
		return nil, errors.New("nenhuma versão do PokeSniper foi encontrada no GitHub")
	}

	var size uint64
	present := map[string]bool{}
	for _, file := range archive.File {
		name, ok := strings.CutPrefix(file.Name, latest.base)
		if !ok || file.FileInfo().IsDir() {
			continue
		}
		if !file.Mode().IsRegular() || !safeArchivePath(name) || present[strings.ToLower(name)] {
			return nil, fmt.Errorf("arquivo inválido na atualização: %q", name)
		}
		present[strings.ToLower(name)] = true
		if file.UncompressedSize64 > maxExtension-size {
			return nil, errors.New("a atualização excedeu o tamanho permitido")
		}
		size += file.UncompressedSize64
		if name == "manifest.json" {
			current, err := zipVersion(file)
			if err != nil || current != latest.version {
				return nil, errors.New("o manifesto da atualização tem uma versão incompatível")
			}
		}
		latest.files = append(latest.files, file)
	}
	for _, name := range []string{"manifest.json", "background.js", "market-main.js", "opportunities.html"} {
		if !present[name] {
			return nil, fmt.Errorf("a atualização veio sem %s", name)
		}
	}
	return latest, nil
}

func zipVersion(file *zip.File) (version, error) {
	stream, err := file.Open()
	if err != nil {
		return version{}, err
	}
	defer stream.Close()
	return readVersion(stream)
}

var archiveComponent = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*$`)
var windowsDevice = regexp.MustCompile(`^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$`)

func safeArchivePath(name string) bool {
	if name != path.Clean(name) || !filepath.IsLocal(filepath.FromSlash(name)) {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		stem, _, _ := strings.Cut(part, ".")
		if !archiveComponent.MatchString(part) || strings.HasSuffix(part, ".") || windowsDevice.MatchString(strings.ToUpper(stem)) {
			return false
		}
	}
	return true
}

func fetchUpdate(client *http.Client, etag, releaseFolder string) (*update, string, error) {
	request, err := http.NewRequest(http.MethodGet, updateURL, nil)
	if err != nil {
		return nil, "", err
	}
	if etag != "" {
		request.Header.Set("If-None-Match", etag)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotModified {
		return nil, etag, nil
	}
	if response.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("o GitHub respondeu com HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxArchive+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > maxArchive {
		return nil, "", errors.New("o download excedeu o tamanho permitido")
	}
	release, err := findUpdate(data, releaseFolder)
	return release, response.Header.Get("ETag"), err
}

func extract(file *zip.File, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	in, err := file.Open()
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	written, copyErr := io.Copy(out, io.LimitReader(in, int64(file.UncompressedSize64)+1))
	closeErr := out.Close()
	if written != int64(file.UncompressedSize64) {
		return errors.Join(copyErr, closeErr, errors.New("tamanho de arquivo incompatível na atualização"))
	}
	return errors.Join(copyErr, closeErr)
}

func (u *update) install(folder string) error {
	parent := filepath.Dir(folder)
	if err := os.MkdirAll(parent, 0755); err != nil {
		return err
	}
	staging, err := os.MkdirTemp(parent, ".pokesniper-novo-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	prepared := filepath.Join(staging, "extensao")
	for _, file := range u.files {
		name := strings.TrimPrefix(file.Name, u.base)
		if err := extract(file, filepath.Join(prepared, filepath.FromSlash(name))); err != nil {
			return err
		}
	}
	if _, err := os.Stat(folder); errors.Is(err, os.ErrNotExist) {
		return os.Rename(prepared, folder)
	} else if err != nil {
		return err
	}

	backupDir, err := os.MkdirTemp(parent, ".pokesniper-backup-")
	if err != nil {
		return err
	}
	backup := filepath.Join(backupDir, "extensao")
	if err := os.Rename(folder, backup); err != nil {
		os.Remove(backupDir)
		return err
	}
	if err := os.Rename(prepared, folder); err != nil {
		if restoreErr := os.Rename(backup, folder); restoreErr != nil {
			return fmt.Errorf("a atualização falhou. A versão anterior está em %s: %w", backup, errors.Join(err, restoreErr))
		}
		os.Remove(backupDir)
		return err
	}
	// Mantém a cópia anterior caso o navegador rejeite o pacote novo ao iniciar.
	return nil
}
