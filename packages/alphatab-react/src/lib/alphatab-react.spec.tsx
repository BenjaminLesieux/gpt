import { render } from '@testing-library/react';

import OrgAlphatabReact from './alphatab-react';

describe('OrgAlphatabReact', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<OrgAlphatabReact />);
    expect(baseElement).toBeTruthy();
  });
});
