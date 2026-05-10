package service

// firstNonNil keeps event payload normalization deterministic when upstream
// providers use alternate field names for the same stream value.
func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}
