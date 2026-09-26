import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';

describe('shared state components', () => {
  it('renders EmptyState with title and subtitle', async () => {
    await render(
      <EmptyState title="Nothing here yet" subtitle="Poems you save will show up" />,
    );
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(screen.getByText('Poems you save will show up')).toBeTruthy();
  });

  it('renders ErrorState with retry action', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState message="Something went wrong" onRetry={onRetry} />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders LoadingState with default label', async () => {
    await render(<LoadingState />);
    expect(screen.getByLabelText('Loading...')).toBeTruthy();
  });
});
