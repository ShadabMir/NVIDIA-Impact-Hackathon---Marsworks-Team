import pytest
from pydantic import ValidationError

from app.agent_schemas import LegOut
from app.schemas import JourneyLeg, MapStop, RouteGeometry


@pytest.mark.parametrize("mode", ["bus", "tram"])
def test_both_leg_contracts_preserve_transport_geometry(mode):
    shape = {"type": "LineString", "coordinates": [[-1.48, 53.38], [-1.47, 53.39]]}
    stops = [{"name": "Example stop", "coordinate": [-1.48, 53.38]}]
    for model in (JourneyLeg, LegOut):
        duration = {"duration_minutes": 10} if model is JourneyLeg else {"minutes": 10}
        leg = model(mode=mode, instruction="Board the service", **duration,
                    line="Example", geometry=shape, map_stops=stops)
        assert leg.model_dump(mode="json")["geometry"] == shape
        assert leg.model_dump(mode="json")["map_stops"] == stops


def test_invalid_route_and_stop_coordinates_are_rejected():
    with pytest.raises(ValidationError):
        RouteGeometry(type="LineString", coordinates=[[999, 53], [-1, 53]])
    with pytest.raises(ValidationError):
        MapStop(name="Invalid", coordinate=[-1, float("nan")])
