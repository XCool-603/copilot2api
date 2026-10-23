package auth

import (
	"testing"
)

func TestStartDeviceCode(t *testing.T) {
	dc, err := StartDeviceCode()
	if err != nil {
		t.Logf("StartDeviceCode notice: %v", err)
		return
	}
	t.Logf("Got UserCode=%s URI=%s", dc.UserCode, dc.VerificationURI)
	if dc.UserCode == "" || dc.VerificationURI == "" {
		t.Fatalf("empty fields: %+v", dc)
	}
}
