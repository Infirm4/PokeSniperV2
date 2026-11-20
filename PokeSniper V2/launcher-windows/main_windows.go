package main

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const gameURL = "https://pokeidle.io/"

const (
	okIcon      = 0x40
	errorIcon   = 0x10
	yesNoCancel = 3
	okCancel    = 1
	yes         = 6
	no          = 7
	ok          = 1
)

var messageBoxW = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
var createMutexW = syscall.NewLazyDLL("kernel32.dll").NewProc("CreateMutexW")

//go:embed assets/desktop.ico
var desktopIcon []byte

type config struct {
	ExtensionFolder string `json:"extension_folder"`
	Installed       string `json:"installed_version,omitempty"`
	ETag            string `json:"etag,omitempty"`
}

func message(text string, flags uintptr) uintptr {
	body, _ := syscall.UTF16PtrFromString(text)
	caption, _ := syscall.UTF16PtrFromString("PokeSniper")
	answer, _, _ := messageBoxW.Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(caption)), flags|0x10000)
	return answer
}

func silent(name string, args ...string) *exec.Cmd {
	command := exec.Command(name, args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return command
}

func windowsPowerShell(script string, vars ...string) ([]byte, error) {
	program := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	command := silent(program, "-NoProfile", "-STA", "-Command", "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; "+script)
	command.Env = append(os.Environ(), vars...)
	return command.Output()
}

func findChrome() (string, error) {
	for _, root := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")} {
		if root == "" {
			continue
		}
		candidate := filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe")
		if file, err := os.Stat(candidate); err == nil && !file.IsDir() {
			return candidate, nil
		}
	}
	chrome, err := exec.LookPath("chrome.exe")
	if err != nil {
		return "", errors.New("O Google Chrome não foi encontrado neste computador.")
	}
	return chrome, nil
}

func chromeRunning() (bool, error) {
	program := filepath.Join(os.Getenv("SystemRoot"), "System32", "tasklist.exe")
	data, err := silent(program, "/FI", "IMAGENAME eq chrome.exe", "/FO", "CSV", "/NH").Output()
	return strings.Contains(strings.ToLower(string(data)), `"chrome.exe",`), err
}

func waitForChromeExit(next version, existing bool) bool {
	prompt := "PokeSniper " + next.String() + " disponível. Saia do Chrome pelo menu ⋮ → Sair e clique em OK.\n\nCancelar abre o PokéIdle com a versão atual."
	if !existing {
		prompt = "Para restaurar a pasta da extensão, saia do Chrome pelo menu ⋮ → Sair e clique em OK.\n\nCancelar deixa a recuperação para depois."
	}
	for {
		running, err := chromeRunning()
		if err != nil {
			message("Não foi possível confirmar se o Chrome está aberto. Saia do navegador e tente novamente.", okIcon)
			return false
		}
		if !running {
			return true
		}
		if message(prompt, okCancel|okIcon) != ok {
			return false
		}
	}
}

func selectExtension(home string) (string, bool, error) {
	switch message("Você já usa a extensão PokeSniper no Chrome?\n\nSim: selecione o arquivo manifest.json da pasta já usada pelo Chrome para preservar seus dados.\nNão: prepare uma instalação nova.", yesNoCancel|okIcon) {
	case yes:
		data, err := windowsPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$picker = New-Object System.Windows.Forms.OpenFileDialog
$picker.Title = 'Selecione o manifest.json do PokeSniper já instalado'
$picker.Filter = 'Manifesto do Chrome (manifest.json)|manifest.json'
$picker.CheckFileExists = $true
try {
	if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($picker.FileName) }
} finally { $picker.Dispose() }
`)
		if err != nil {
			return "", false, fmt.Errorf("não foi possível selecionar a extensão: %w", err)
		}
		picked := strings.TrimSpace(string(data))
		if picked == "" {
			return "", false, nil
		}
		if !strings.EqualFold(filepath.Base(picked), "manifest.json") {
			return "", false, errors.New("selecione o manifest.json já usado pelo Chrome")
		}
		folder := filepath.Dir(picked)
		if _, err := installedVersion(folder); err != nil {
			return "", false, err
		}
		return folder, false, nil
	case no:
		return filepath.Join(home, "Extensao"), true, nil
	default:
		return "", false, nil
	}
}

func recoverExtension(folder, home string, reason error) (string, bool, bool, error) {
	if errors.Is(reason, os.ErrNotExist) && canRestoreExtension(folder) {
		prompt := "A pasta da extensão não foi encontrada:\n\n" + folder + "\n\nSim: baixar a extensão de novo neste mesmo caminho para o Chrome recuperar a instalação.\nNão: indicar outra pasta ou preparar uma instalação nova."
		switch message(prompt, yesNoCancel|okIcon) {
		case yes:
			return folder, false, true, nil
		case no:
		default:
			return "", false, false, nil
		}
	} else if message("A extensão está indisponível neste caminho:\n\n"+folder+"\n\nClique em OK para selecionar a pasta atual ou preparar uma instalação nova.", okCancel|okIcon) != ok {
		return "", false, false, nil
	}
	selected, newInstall, err := selectExtension(home)
	return selected, newInstall, false, err
}

func readConfig(file string) (config, error) {
	data, err := os.ReadFile(file)
	if errors.Is(err, os.ErrNotExist) {
		return config{}, nil
	}
	if err != nil {
		return config{}, err
	}
	var result config
	err = json.Unmarshal(data, &result)
	return result, err
}

func writeConfig(file string, data config) error {
	payload, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(file), "config-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	_, writeErr := temp.Write(payload)
	if err := errors.Join(writeErr, temp.Close()); err != nil {
		return err
	}
	return os.Rename(temp.Name(), file)
}

func makeDesktopShortcut(home string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	exe := filepath.Join(home, "PokeSniper.exe")
	if !strings.EqualFold(filepath.Clean(self), exe) {
		data, err := os.ReadFile(self)
		if err != nil {
			return err
		}
		if err := os.WriteFile(exe, data, 0755); err != nil {
			return err
		}
	}

	icon := filepath.Join(home, "PokeSniper.ico")
	art := desktopIcon
	// Um ICO fornecido junto do executável substitui a arte embutida no atalho.
	if file := filepath.Join(filepath.Dir(self), "PokeSniper.ico"); !strings.EqualFold(file, icon) {
		if data, err := os.ReadFile(file); err == nil {
			art = data
		}
	}
	if err := os.WriteFile(icon, art, 0644); err != nil {
		return err
	}
	_, err = windowsPowerShell(`
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
if (-not $desktop) { throw 'Pasta da área de trabalho indisponível' }
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop 'PokeSniper.lnk'))
$link.TargetPath = $env:PIS_SHORTCUT_EXE
$link.WorkingDirectory = Split-Path -Parent $env:PIS_SHORTCUT_EXE
$link.IconLocation = "$env:PIS_SHORTCUT_ICON,0"
$link.Description = 'Atualiza o PokeSniper e abre o PokéIdle no Chrome'
$link.Save()
`, "PIS_SHORTCUT_EXE="+exe, "PIS_SHORTCUT_ICON="+icon)
	return err
}

func openChrome(chrome string, pages ...string) error {
	return exec.Command(chrome, pages...).Start()
}

func run() error {
	chrome, err := findChrome()
	if err != nil {
		return err
	}
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return errors.New("a pasta LocalAppData do Windows não está disponível")
	}
	home := filepath.Join(local, "PokeSniper")
	if err := os.MkdirAll(home, 0755); err != nil {
		return err
	}
	configFile := filepath.Join(home, "launcher.json")
	setup, err := readConfig(configFile)
	if err != nil {
		return err
	}

	firstRun := setup.ExtensionFolder == ""
	var newInstall, restoring bool
	if firstRun {
		setup.ExtensionFolder, newInstall, err = selectExtension(home)
		if err != nil || setup.ExtensionFolder == "" {
			return err
		}
	}
	localVersion, localErr := installedVersion(setup.ExtensionFolder)
	if localErr != nil && !firstRun {
		previous := setup.ExtensionFolder
		setup.ExtensionFolder, newInstall, restoring, err = recoverExtension(previous, home, localErr)
		if err != nil || setup.ExtensionFolder == "" {
			return err
		}
		setup.ETag = ""
		localVersion, localErr = installedVersion(setup.ExtensionFolder)
	}
	if localErr != nil && (!(newInstall || restoring) || !errors.Is(localErr, os.ErrNotExist) || !canRestoreExtension(setup.ExtensionFolder)) {
		return fmt.Errorf("não foi possível usar a pasta da extensão em %s: %w", setup.ExtensionFolder, localErr)
	}
	if localErr != nil || setup.Installed != localVersion.String() {
		setup.ETag = ""
	}
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return errors.New("a origem da atualização mudou")
	}}
	remote, etag, err := fetchUpdate(client, setup.ETag)

	switch {
	case err != nil:
		if localErr != nil {
			return fmt.Errorf("não foi possível baixar o PokeSniper: %w", err)
		}
	case remote != nil && (localErr != nil || remote.version.newerThan(localVersion)):
		if (newInstall && !restoring && localErr != nil) || waitForChromeExit(remote.version, localErr == nil) {
			if err := remote.install(setup.ExtensionFolder); err != nil {
				problem := fmt.Errorf("não foi possível aplicar a atualização: %w", err)
				if restored, readErr := installedVersion(setup.ExtensionFolder); readErr != nil || restored != localVersion {
					return problem
				}
				message(problem.Error()+"\n\nO PokéIdle abrirá com a versão instalada.", okIcon)
			} else {
				localVersion, setup.ETag = remote.version, etag
			}
		} else if localErr != nil {
			return nil
		}
	default:
		if localErr != nil {
			return errors.New("o GitHub ainda não forneceu uma versão para recuperar a extensão")
		}
		setup.ETag = etag
	}

	setup.Installed = localVersion.String()
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if firstRun || !strings.EqualFold(filepath.Clean(self), filepath.Join(home, "PokeSniper.exe")) {
		if err := makeDesktopShortcut(home); err != nil {
			return fmt.Errorf("não foi possível criar o atalho: %w", err)
		}
	}
	if err := writeConfig(configFile, setup); err != nil {
		return err
	}
	if restoring {
		message("Pasta restaurada no endereço anterior. Se a extensão aparecer com erro no Chrome, clique em Recarregar. Se estiver fora da lista, use Carregar sem compactação e indique:\n\n"+setup.ExtensionFolder, okIcon)
		return openChrome(chrome, gameURL, "chrome://extensions/")
	}
	if newInstall {
		message("O PokeSniper foi baixado. Faça este passo uma vez no Chrome.\n\nAtive o Modo do desenvolvedor, clique em Carregar sem compactação e escolha:\n\n"+setup.ExtensionFolder+"\n\nDepois de carregar a extensão, volte à aba do PokéIdle e recarregue o jogo.", okIcon)
		return openChrome(chrome, gameURL, "chrome://extensions/")
	}
	return openChrome(chrome, gameURL)
}

func main() {
	mutex, _ := syscall.UTF16PtrFromString(`Local\PokeSniperLauncher`)
	handle, _, err := createMutexW.Call(0, 0, uintptr(unsafe.Pointer(mutex)))
	if handle == 0 {
		message("Não foi possível iniciar o PokeSniper.", errorIcon)
		return
	}
	defer syscall.CloseHandle(syscall.Handle(handle))
	if err == syscall.ERROR_ALREADY_EXISTS {
		return
	}
	if err := run(); err != nil {
		message(err.Error(), errorIcon)
	}
}
