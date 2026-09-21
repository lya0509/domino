CREATE POLICY "Admins can manage waitlist"
ON public.waitlist
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  )
);
