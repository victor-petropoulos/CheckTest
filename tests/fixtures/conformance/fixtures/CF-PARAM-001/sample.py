import pytest

@pytest.mark.parametrize('value', [1, 2])
def test_parameterized(value):
    assert value == value
