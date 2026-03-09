package service

import (
	"testing"

	"github.com/openagents/gateway/internal/model"
)

func TestCollectSkillNamesPreservesOrder(t *testing.T) {
	t.Parallel()

	skills := []struct {
		name string
	}{
		{name: "analysis"},
		{name: "research"},
	}
	got := collectSkillNames([]model.Skill{
		{Name: skills[0].name},
		{Name: skills[1].name},
	})
	want := []string{"analysis", "research"}
	if len(got) != len(want) {
		t.Fatalf("collectSkillNames() len = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("collectSkillNames()[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}
