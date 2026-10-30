package web

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type apiKeyRecord struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	Hash       string     `json:"hash"`
	Raw        string     `json:"raw,omitempty"`
	Key        string     `json:"key,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	Revoked    bool       `json:"revoked"`
}
type apiKeyStore struct {
	mu      sync.Mutex
	Path    string
	Keys    []apiKeyRecord `json:"keys"`
	persist *persistStore
}

func newAPIKeyStore(path string) *apiKeyStore {
	s := &apiKeyStore{Path: path}
	s.persist = &persistStore{flush: s.flush}
	return s
}

func resolveAPIKeysPath() string {
	if p := strings.TrimSpace(os.Getenv("M365_API_KEYS")); p != "" {
		return p
	}

	var candidates []string
	if dir := strings.TrimSpace(os.Getenv("M365_DATA_DIR")); dir != "" {
		candidates = append(candidates,
			filepath.Join(dir, "api-keys.json"),
			filepath.Join(dir, "api_keys.json"),
			filepath.Join(dir, "keys.json"),
		)
	}
	if cfg := strings.TrimSpace(os.Getenv("M365_CONFIG")); cfg != "" {
		cfgDir := filepath.Dir(cfg)
		candidates = append(candidates,
			filepath.Join(cfgDir, "api-keys.json"),
			filepath.Join(cfgDir, "api_keys.json"),
			filepath.Join(cfgDir, "keys.json"),
		)
	}
	h, _ := os.UserHomeDir()
	if h != "" {
		candidates = append(candidates,
			filepath.Join(h, ".config", "m365-copilot2api", "api-keys.json"),
			filepath.Join(h, ".config", "m365-copilot2api", "api_keys.json"),
			filepath.Join(h, ".config", "m365-copilot2api", "keys.json"),
			filepath.Join(h, ".config", "m365-native", "api-keys.json"),
			filepath.Join(h, ".config", "m365-native", "api_keys.json"),
		)
	}
	candidates = append(candidates,
		filepath.Join(".", "data", "api-keys.json"),
		filepath.Join(".", "data", "api_keys.json"),
		filepath.Join(".", "api-keys.json"),
	)

	for _, cand := range candidates {
		if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
			return cand
		}
	}

	if dir := strings.TrimSpace(os.Getenv("M365_DATA_DIR")); dir != "" {
		return filepath.Join(dir, "api-keys.json")
	}
	if cfg := strings.TrimSpace(os.Getenv("M365_CONFIG")); cfg != "" {
		return filepath.Join(filepath.Dir(cfg), "api-keys.json")
	}
	if h != "" {
		return filepath.Join(h, ".config", "m365-copilot2api", "api-keys.json")
	}
	return filepath.Join(".", "api-keys.json")
}

func parseAPIKeysJSON(b []byte) []apiKeyRecord {
	b = []byte(strings.TrimSpace(string(b)))
	if len(b) == 0 {
		return nil
	}

	var wrapper struct {
		Keys []apiKeyRecord `json:"keys"`
	}
	if err := json.Unmarshal(b, &wrapper); err == nil && len(wrapper.Keys) > 0 {
		return wrapper.Keys
	}

	var altWrapper struct {
		Keys []apiKeyRecord `json:"api_keys"`
	}
	if err := json.Unmarshal(b, &altWrapper); err == nil && len(altWrapper.Keys) > 0 {
		return altWrapper.Keys
	}

	var list []apiKeyRecord
	if err := json.Unmarshal(b, &list); err == nil && len(list) > 0 {
		return list
	}

	var strList []string
	if err := json.Unmarshal(b, &strList); err == nil && len(strList) > 0 {
		var out []apiKeyRecord
		for _, raw := range strList {
			raw = strings.TrimSpace(raw)
			if raw == "" {
				continue
			}
			h := keyHash(raw)
			prefix := raw
			if len(prefix) > 12 {
				prefix = prefix[:12]
			}
			idSum := sha256.Sum256([]byte(raw))
			out = append(out, apiKeyRecord{
				ID:        hex.EncodeToString(idSum[:4]),
				Name:      "Imported Key",
				Prefix:    prefix,
				Hash:      h,
				CreatedAt: time.Now(),
			})
		}
		return out
	}

	return nil
}

func openAPIKeys() *apiKeyStore {
	p := resolveAPIKeysPath()
	s := newAPIKeyStore(p)
	b, e := os.ReadFile(p)
	if e != nil {
		for _, altName := range []string{"api_keys.json", "keys.json"} {
			altPath := filepath.Join(filepath.Dir(p), altName)
			if altB, altErr := os.ReadFile(altPath); altErr == nil && len(altB) > 0 {
				b = altB
				e = nil
				break
			}
		}
	}

	if e == nil && len(b) > 0 {
		records := parseAPIKeysJSON(b)
		migrated := false
		for i := range records {
			r := &records[i]
			if r.Key != "" && r.Hash == "" {
				r.Hash = keyHash(r.Key)
				r.Key = ""
				migrated = true
			}
			if r.Raw != "" {
				if r.Hash == "" {
					r.Hash = keyHash(r.Raw)
				}
				r.Raw = ""
				migrated = true
			}
			if r.ID == "" {
				if r.Hash != "" && len(r.Hash) >= 8 {
					r.ID = r.Hash[:8]
				} else {
					idBytes := sha256.Sum256([]byte(time.Now().String() + r.Prefix))
					r.ID = hex.EncodeToString(idBytes[:4])
				}
				migrated = true
			}
			if r.Prefix == "" && r.Hash != "" {
				if len(r.Hash) >= 12 {
					r.Prefix = r.Hash[:12]
				} else {
					r.Prefix = r.Hash
				}
				migrated = true
			}
			if r.CreatedAt.IsZero() {
				r.CreatedAt = time.Now()
			}
		}
		s.Keys = records
		if migrated {
			_ = s.flush()
		}
	}
	return s
}
func (s *apiKeyStore) flush() error {
	s.mu.Lock()
	b, err := json.MarshalIndent(s, "", "  ")
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.Path), 0700); err != nil {
		return err
	}
	return writeFileAtomic(s.Path, b, 0600)
}
func keyHash(k string) string { h := sha256.Sum256([]byte(k)); return hex.EncodeToString(h[:]) }
func (s *apiKeyStore) createWithKey(name, customKey string) (apiKeyRecord, string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "API key"
	}
	customKey = strings.TrimSpace(customKey)
	var raw string
	if customKey != "" {
		raw = customKey
	} else {
		b := make([]byte, 32)
		if _, e := rand.Read(b); e != nil {
			return apiKeyRecord{}, "", e
		}
		raw = "m365_" + hex.EncodeToString(b)
	}

	h := keyHash(raw)
	idSum := sha256.Sum256([]byte(raw + time.Now().String()))
	id := hex.EncodeToString(idSum[:4])
	prefix := raw
	if len(prefix) > 12 {
		prefix = prefix[:12]
	}

	r := apiKeyRecord{
		ID:        id,
		Name:      name,
		Prefix:    prefix,
		Hash:      h,
		CreatedAt: time.Now(),
	}
	s.mu.Lock()
	s.Keys = append(s.Keys, r)
	s.mu.Unlock()
	if err := s.persist.flushNowBlocking(); err != nil {
		s.mu.Lock()
		s.Keys = s.Keys[:len(s.Keys)-1]
		s.mu.Unlock()
		return apiKeyRecord{}, "", err
	}
	r.Hash = ""
	r.Raw = ""
	return r, raw, nil
}

func (s *apiKeyStore) create(name string) (apiKeyRecord, string, error) {
	return s.createWithKey(name, "")
}
func (s *apiKeyStore) list() []apiKeyRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]apiKeyRecord, len(s.Keys))
	copy(out, s.Keys)
	for i := range out {
		out[i].Hash = ""
		out[i].Raw = ""
	}
	return out
}
func (s *apiKeyStore) revoke(id string) (bool, error) {
	s.mu.Lock()
	for i := range s.Keys {
		if s.Keys[i].ID == id && !s.Keys[i].Revoked {
			s.Keys[i].Revoked = true
			s.mu.Unlock()
			if err := s.persist.flushNowBlocking(); err != nil {
				s.mu.Lock()
				s.Keys[i].Revoked = false
				s.mu.Unlock()
				return false, err
			}
			return true, nil
		}
	}
	s.mu.Unlock()
	return false, nil
}

// delete physically removes a key record, rolling back on persistence failure.
func (s *apiKeyStore) delete(id string) (bool, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return false, nil
	}
	s.mu.Lock()
	for i := range s.Keys {
		if s.Keys[i].ID == id || s.Keys[i].Prefix == id || s.Keys[i].Hash == id || s.Keys[i].Name == id {
			removed := s.Keys[i]
			s.Keys = append(s.Keys[:i], s.Keys[i+1:]...)
			s.mu.Unlock()
			if err := s.persist.flushNowBlocking(); err != nil {
				s.mu.Lock()
				s.Keys = append(s.Keys[:i], append([]apiKeyRecord{removed}, s.Keys[i:]...)...)
				s.mu.Unlock()
				return false, err
			}
			return true, nil
		}
	}
	s.mu.Unlock()
	return false, nil
}

func (s *apiKeyStore) update(id, name string, revoked *bool) (bool, error) {
	s.mu.Lock()
	found := false
	var oldName string
	var oldRevoked bool
	for i := range s.Keys {
		if s.Keys[i].ID != id {
			continue
		}
		oldName = s.Keys[i].Name
		oldRevoked = s.Keys[i].Revoked
		if name != "" {
			s.Keys[i].Name = name
		}
		if revoked != nil {
			s.Keys[i].Revoked = *revoked
		}
		found = true
		break
	}
	s.mu.Unlock()
	if !found {
		return false, nil
	}
	if err := s.persist.flushNowBlocking(); err != nil {
		s.mu.Lock()
		for i := range s.Keys {
			if s.Keys[i].ID == id {
				s.Keys[i].Name = oldName
				s.Keys[i].Revoked = oldRevoked
				break
			}
		}
		s.mu.Unlock()
		return false, err
	}
	return true, nil
}
func (s *apiKeyStore) valid(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	s.mu.Lock()
	h := keyHash(raw)
	found := false
	for i := range s.Keys {
		if s.Keys[i].Revoked {
			continue
		}
		if s.Keys[i].Hash == h ||
			s.Keys[i].Hash == raw ||
			(s.Keys[i].Raw != "" && s.Keys[i].Raw == raw) ||
			(s.Keys[i].Key != "" && s.Keys[i].Key == raw) ||
			(s.Keys[i].ID != "" && s.Keys[i].ID == raw) ||
			(s.Keys[i].Prefix != "" && s.Keys[i].Prefix == raw) {
			now := time.Now()
			s.Keys[i].LastUsedAt = &now
			if s.Keys[i].Hash == "" || s.Keys[i].Hash == raw {
				s.Keys[i].Hash = h
			}
			found = true
			break
		}
	}
	s.mu.Unlock()
	if found && s.persist != nil {
		s.persist.markDirty()
	}
	return found
}
