package ingest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// schema reads the shared contract instead of restating it here. A field added
// to the schema and not to the struct fails on this side, which is what makes
// one definition across three languages hold.
func schema(t *testing.T, name string) map[string]json.RawMessage {
	t.Helper()
	path := filepath.Join("..", "..", "packages", "contracts", "schema", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("cannot read %s: %v", path, err)
	}
	var doc struct {
		Properties map[string]json.RawMessage `json:"properties"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("cannot parse %s: %v", path, err)
	}
	if len(doc.Properties) == 0 {
		t.Fatalf("%s declares no properties", path)
	}
	return doc.Properties
}

func schemaFields(t *testing.T, name string) []string {
	t.Helper()
	out := make([]string, 0)
	for k := range schema(t, name) {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func jsonTags(t *testing.T, v any) []string {
	t.Helper()
	typ := reflect.TypeOf(v)
	out := make([]string, 0, typ.NumField())
	for i := range typ.NumField() {
		tag := typ.Field(i).Tag.Get("json")
		if tag == "" || tag == "-" {
			t.Fatalf("field %s carries no json tag, so it cannot be checked", typ.Field(i).Name)
		}
		out = append(out, tag)
	}
	sort.Strings(out)
	return out
}

func TestRunMatchesTheSharedSchema(t *testing.T) {
	if want, got := schemaFields(t, "run.schema.json"), jsonTags(t, Run{}); !reflect.DeepEqual(want, got) {
		t.Fatalf("Run drifted from the contract.\n schema: %v\n struct: %v", want, got)
	}
}

func TestStageMatchesTheSharedSchema(t *testing.T) {
	if want, got := schemaFields(t, "stage.schema.json"), jsonTags(t, Stage{}); !reflect.DeepEqual(want, got) {
		t.Fatalf("Stage drifted from the contract.\n schema: %v\n struct: %v", want, got)
	}
}

// enumOf pulls the allowed values for one property out of the schema.
func enumOf(t *testing.T, file, property string) []string {
	t.Helper()
	var field struct {
		Enum []string `json:"enum"`
	}
	if err := json.Unmarshal(schema(t, file)[property], &field); err != nil {
		t.Fatalf("cannot read the enum for %s: %v", property, err)
	}
	if len(field.Enum) == 0 {
		t.Fatalf("%s.%s declares no enum", file, property)
	}
	sort.Strings(field.Enum)
	return field.Enum
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func TestAcceptedOutcomesMatchTheSchema(t *testing.T) {
	if want, got := enumOf(t, "run.schema.json", "outcome"), keys(outcomes); !reflect.DeepEqual(want, got) {
		t.Fatalf("accepted outcomes drifted.\n schema: %v\n code:   %v", want, got)
	}
}

func TestAcceptedStageNamesMatchTheSchema(t *testing.T) {
	if want, got := enumOf(t, "stage.schema.json", "name"), keys(stageNames); !reflect.DeepEqual(want, got) {
		t.Fatalf("accepted stage names drifted.\n schema: %v\n code:   %v", want, got)
	}
}
