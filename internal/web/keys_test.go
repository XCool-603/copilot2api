package web

import "testing"

func TestAPIKeyCreateRollsBackWhenPersistenceFails(t *testing.T) {
	store := newAPIKeyStore(t.TempDir())
	if _, _, err := store.create("test"); err == nil {
		t.Fatal("expected persistence error")
	}
	if got := len(store.Keys); got != 0 {
		t.Fatalf("retained %d in-memory keys after failed save", got)
	}
}

func TestAPIKeyRevokeRollsBackWhenPersistenceFails(t *testing.T) {
	store := newAPIKeyStore(t.TempDir() + "/api-keys.json")
	record, _, err := store.create("test")
	if err != nil {
		t.Fatal(err)
	}
	store.Path = t.TempDir()
	revoked, err := store.revoke(record.ID)
	if err == nil || revoked {
		t.Fatalf("revoke=%v err=%v, want persistence failure", revoked, err)
	}
	if store.Keys[0].Revoked {
		t.Fatal("key remained revoked after failed save")
	}
}

func TestAPIKeyDeletePhysicallyRemoves(t *testing.T) {
	store := newAPIKeyStore(t.TempDir() + "/api-keys.json")
	r1, _, err := store.create("one")
	if err != nil {
		t.Fatal(err)
	}
	r2, _, err := store.create("two")
	if err != nil {
		t.Fatal(err)
	}
	deleted, err := store.delete(r1.ID)
	if err != nil || !deleted {
		t.Fatalf("delete=%v err=%v", deleted, err)
	}
	for _, k := range store.Keys {
		if k.ID == r1.ID {
			t.Fatal("key still present after delete")
		}
	}
	if len(store.Keys) != 1 || store.Keys[0].ID != r2.ID {
		t.Fatalf("unexpected remaining keys: %+v", store.Keys)
	}
	if deleted, _ := store.delete("no-such-id"); deleted {
		t.Fatal("delete of unknown id should report false")
	}
}

func TestAPIKeyDeleteRollsBackWhenPersistenceFails(t *testing.T) {
	store := newAPIKeyStore(t.TempDir() + "/api-keys.json")
	record, _, err := store.create("test")
	if err != nil {
		t.Fatal(err)
	}
	store.Path = t.TempDir()
	deleted, err := store.delete(record.ID)
	if err == nil || deleted {
		t.Fatalf("delete=%v err=%v, want persistence failure", deleted, err)
	}
	if len(store.Keys) != 1 || store.Keys[0].ID != record.ID {
		t.Fatalf("key not restored after failed delete: %+v", store.Keys)
	}
}

func TestAPIKeyCreateWithCustomKeyAndValidate(t *testing.T) {
	tmpFile := t.TempDir() + "/api-keys.json"
	store := newAPIKeyStore(tmpFile)
	rec, raw, err := store.createWithKey("custom", "sk-custom-secret-key-12345")
	if err != nil {
		t.Fatalf("createWithKey error: %v", err)
	}
	if raw != "sk-custom-secret-key-12345" {
		t.Fatalf("expected raw key sk-custom-secret-key-12345, got %s", raw)
	}
	if !store.valid("sk-custom-secret-key-12345") {
		t.Fatal("expected custom key to be valid")
	}
	// Prefix match
	if !store.valid(rec.Prefix) {
		t.Fatal("expected prefix to be valid")
	}
	// ID match
	if !store.valid(rec.ID) {
		t.Fatal("expected ID to be valid")
	}
}

func TestParseAPIKeysJSONCompatibility(t *testing.T) {
	// 1. Array of objects with "key"
	jsonArr := []byte(`[{"id":"k1","name":"legacy","key":"sk-legacy-123"}]`)
	records := parseAPIKeysJSON(jsonArr)
	if len(records) != 1 || records[0].Key != "sk-legacy-123" {
		t.Fatalf("failed to parse array of records: %+v", records)
	}

	// 2. Array of string keys
	jsonStrs := []byte(`["sk-plain-1", "sk-plain-2"]`)
	records2 := parseAPIKeysJSON(jsonStrs)
	if len(records2) != 2 {
		t.Fatalf("failed to parse array of strings: %+v", records2)
	}

	// 3. Object with "api_keys"
	jsonObj := []byte(`{"api_keys":[{"id":"k3","name":"obj","hash":"12345678"}]}`)
	records3 := parseAPIKeysJSON(jsonObj)
	if len(records3) != 1 || records3[0].ID != "k3" {
		t.Fatalf("failed to parse api_keys object: %+v", records3)
	}
}
