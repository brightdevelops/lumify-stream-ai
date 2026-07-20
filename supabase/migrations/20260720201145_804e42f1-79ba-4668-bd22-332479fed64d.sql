
UPDATE public.support_autoreply_rules
SET response = 'Sorry about the payment trouble! Please share the transaction ID or the email you used and we''ll look into it. You can also try again with your card or bank transfer via Flutterwave.'
WHERE id = '4541ef6d-022a-475a-99d9-c6c1771f8386';

UPDATE public.support_autoreply_rules
SET triggers = ARRAY['payment methods','how do i pay','payment options','accepted payments','can i pay with'],
    response = 'We accept card and bank payments (card, bank transfer, USSD, mobile money) via Flutterwave in NGN. Just choose a credit pack on the Credits page and follow the checkout.'
WHERE id = '1574c7a4-cb1f-47ba-a326-df67d668ab3c';
