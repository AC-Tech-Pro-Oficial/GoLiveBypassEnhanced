package bugreport

import (
	"fmt"
	"sort"
	"strings"
)

const (
	MaxTitleLen       = 200
	MaxDescriptionLen = 8 * 1024
	// O GitHub recusa issues com body > 64KB (limite da API REST). O body montado
	// aqui (meta + descricao + log) precisa caber — corta-se o LOG por ultimo,
	// preservando meta e descricao que sao o diagnostico essencial.
	MaxIssueBodyLen = 64 * 1024
	logFence        = "````"
)

type Report struct {
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Log         string            `json:"log"`
	Meta        map[string]string `json:"meta"`
}

func (r *Report) Validate(maxLogBytes int64) error {
	r.Title = strings.TrimSpace(r.Title)
	switch {
	case r.Title == "":
		return fmt.Errorf("title e obrigatorio")
	case len(r.Title) > MaxTitleLen:
		return fmt.Errorf("title deve ter no maximo %d caracteres", MaxTitleLen)
	}
	if len(r.Description) > MaxDescriptionLen {
		return fmt.Errorf("description deve ter no maximo %d caracteres", MaxDescriptionLen)
	}
	if int64(len(r.Log)) > maxLogBytes {
		r.Log = r.Log[:maxLogBytes]
	}
	return nil
}

func BuildIssueBody(r Report) string {
	var b strings.Builder
	b.WriteString("Relato enviado pela API de bug reports.\n\n")

	if len(r.Meta) > 0 {
		b.WriteString("**Sistema:**\n\n| | |\n|---|---|\n")
		keys := make([]string, 0, len(r.Meta))
		for k := range r.Meta {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fmt.Fprintf(&b, "| %s | %s |\n", tableCell(k), tableCell(r.Meta[k]))
		}
		b.WriteString("\n")
	}

	if d := strings.TrimSpace(r.Description); d != "" {
		b.WriteString("**Descrição:**\n\n")
		b.WriteString(d)
		b.WriteString("\n\n")
	}

	if l := r.Log; l != "" {
		log := strings.ReplaceAll(l, logFence, "```")
		prefixo := b.String()
		const fenceBloco = "\n" + logFence + "\n"
		const marcador = "\n[... log truncado no meio ...]\n"
		// "**Log:**\n\n" + fence aberto + log + fence fechado — inclui o \n inicial
		// e reserva espaco para o marcador de truncamento.
		baseLen := len(prefixo) + len("\n**Log:**\n\n") + len(logFence) + len(fenceBloco) + len(marcador)
		sobra := MaxIssueBodyLen - baseLen
		if sobra < 0 {
			sobra = 0
		}
		if len(log) > sobra {
			// Truncamento head+tail: preserva o INICIO (secoes de deteccao/installs,
			// o trace da GUI) e o FIM (eventos recentes do gateway), cortando o meio.
			// Cortar so o fim perdia exatamente o diagnostico de "nao achou o Vesktop".
			cabeca := sobra / 2
			cauda := sobra - cabeca

			// Cabeca: ate a ultima quebra de linha dentro da cota.
			if nova := strings.LastIndexByte(log[:cabeca], '\n'); nova > 0 {
				cabeca = nova + 1
			}
			// Cauda: a partir da primeira quebra de linha dentro da cota (nao
			// comeca no meio de uma linha).
			inicioCauda := len(log) - cauda
			if nova := strings.IndexByte(log[inicioCauda:], '\n'); nova >= 0 {
				inicioCauda += nova + 1
			}
			log = log[:cabeca] + marcador + log[inicioCauda:]
		}
		b.WriteString("**Log:**\n\n")
		b.WriteString(logFence + "\n")
		b.WriteString(log)
		b.WriteString(fenceBloco)
	}
	return b.String()
}

func tableCell(s string) string {
	return strings.NewReplacer("|", "\\|", "\n", " ").Replace(s)
}
