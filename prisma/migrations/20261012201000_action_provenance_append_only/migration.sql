CREATE OR REPLACE FUNCTION action_provenance_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ActionProvenance and ActionProvenanceFinding are append-only; % on % is not permitted', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER action_provenance_no_update_delete
  BEFORE UPDATE OR DELETE ON "ActionProvenance"
  FOR EACH ROW EXECUTE FUNCTION action_provenance_append_only();

CREATE TRIGGER action_provenance_finding_no_update_delete
  BEFORE UPDATE OR DELETE ON "ActionProvenanceFinding"
  FOR EACH ROW EXECUTE FUNCTION action_provenance_append_only();
